"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useAutoMonitor } from "@/components/AutoMonitorProvider";
import {
  backendBaseUrl,
  enableBackgroundSync,
  syncNow,
  getAppVersion,
  healthAvailability,
  isNative,
  openHealthSettings,
  requestHealthPermissions,
  requestNotificationPermission,
  HEALTH_BACKGROUND_PERMISSION,
} from "@/lib/nativeBridge";

/**
 * Kartu aktivasi monitoring otomatis:
 *
 *   hubungkan data kesehatan → izin akses → izin notifikasi →
 *   sinkronisasi background → monitoring aktif
 *
 * jika data kesehatan tidak tersedia, check-in harian dan fitur lain
 * tetap berfungsi normal.
 */
export default function MonitoringCard({ patientId }: { patientId: string }) {
  const { monitoringActive, setMonitoringActive } = useAutoMonitor();
  const [native, setNative] = useState<boolean | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [sdkStatus, setSdkStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showSettingsFallback, setShowSettingsFallback] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const n = await isNative();
      if (cancelled) return;
      setNative(n);
      if (n) {
        // availability + app version in parallel so one slow call
        // doesn't block the other.
        await Promise.allSettled([
          (async () => {
            try {
              const a = await healthAvailability();
              if (!cancelled) {
                setAvailable(a?.available ?? false);
                setSdkStatus(a?.sdkStatus ?? null);
              }
            } catch {
              if (!cancelled) setAvailable(false);
            }
          })(),
          (async () => {
            try {
              const v = await getAppVersion();
              if (!cancelled) setAppVersion(v?.version ?? null);
            } catch {
              if (!cancelled) setAppVersion(null);
            }
          })(),
        ]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** map technical errors to caregiver-friendly guidance. */
  function healthErrorMessage(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("PERMISSION_TIMEOUT")) {
      return "Layar izin akses kesehatan tidak memberi respons. Tutup layar izin bila masih terbuka, lalu tekan Hubungkan lagi — atau aktifkan izin manual lewat tombol Pengaturan di bawah.";
    }
    if (msg.includes("needs an update")) {
      return "Aplikasi pendamping kesehatan perlu diperbarui dari Play Store, lalu coba lagi.";
    }
    if (msg.includes("not available on this device") || msg === "Monitoring health data unavailable") {
      return "Data kesehatan belum tersedia — pastikan aplikasi pendamping kesehatan sudah terpasang dan memiliki data. Check-in harian tetap berfungsi normal.";
    }
    if (msg.includes("Could not open")) {
      return "Layar izin tidak bisa dibuka otomatis. Buka Pengaturan manual lewat tombol di bawah, lalu aktifkan izin baca Tidur, Langkah, dan Detak Jantung untuk Relivia.";
    }
    return `Gagal mengaktifkan monitoring: ${msg}`;
  }

  /** one real system notification as proof it works (best effort). */
  async function fireConfirmationNotification(): Promise<boolean> {
    try {
      const { ensureMonitoringChannel } = await import("@/lib/nativeBridge");
      await ensureMonitoringChannel().catch(() => false);
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const { NOTIFICATION_CHANNEL_ID } = await import("@/lib/notify");
      await LocalNotifications.schedule({
        notifications: [
          {
            title: "Relivia",
            body: "Monitoring aktif. Notifikasi sistem berfungsi — investigasi berikutnya akan muncul di sini.",
            id: 1001,
            schedule: { at: new Date(Date.now() + 1500) },
            channelId: NOTIFICATION_CHANNEL_ID,
            autoCancel: true,
            isExactNotification: false,
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  async function handleConnect() {
    // never gate on the local monitoringActive flag: permission state
    // comes from Health Connect itself on every click, so returning
    // users can always re-sync. (busy disables the button meanwhile.)
    setBusy(true);
    setMessage(null);
    setShowSettingsFallback(false);
    try {
      const onNative = await isNative();

      if (onNative) {
        // notification permission first, so system notifications keep
        // working whatever the health-data result is.
        const notifGranted = await requestNotificationPermission();

        // 1. Minta izin akses data kesehatan. Already-granted → native
        // fast path resolves without showing the permission screen.
        let perm;
        try {
          perm = await requestHealthPermissions();
        } catch (e) {
          setShowSettingsFallback(true);
          throw new Error(healthErrorMessage(e));
        }
        if (!perm.allGranted) {
          setShowSettingsFallback(true);
          setMessage(
            `Izin akses data kesehatan belum lengkap. Buka Pengaturan, aktifkan semua izin baca untuk Relivia, lalu tekan Sinkronkan lagi.${
              !notifGranted ? " (Izin notifikasi sistem juga belum diaktifkan.)" : ""
            }`
          );
          return;
        }
        // 2. Jadwalkan sinkronisasi background dengan token sesi caregiver.
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Sesi login tidak ditemukan. Login ulang.");
        const scheduled = await enableBackgroundSync({
          backendUrl: backendBaseUrl(),
          patientId,
          token,
        });
        if (!scheduled) throw new Error("Gagal menjadwalkan sinkronisasi otomatis.");
        // 3. One-shot import 7 hari terakhir sekarang juga (tanpa
        // menunggu siklus 6 jam). Best effort: periodic worker
        // meng-cover bila ini gagal.
        let immediate = false;
        try {
          immediate = await syncNow({
            backendUrl: backendBaseUrl(),
            patientId,
            token,
          });
        } catch {
          immediate = false;
        }
        setMonitoringActive(true);
        // 4. Background access diverifikasi terpisah dari izin
        // foreground — tidak pernah menghalangi tombol/sync. Bila
        // belum ada, arahkan ke Pengaturan kesehatan untuk pemulihan.
        const hasBackground = (perm.granted ?? []).includes(
          HEALTH_BACKGROUND_PERMISSION
        );
        if (!hasBackground) setShowSettingsFallback(true);
        const bgNote = hasBackground
          ? ""
          : " Untuk sinkronisasi otomatis, aktifkan juga akses background lewat Pengaturan kesehatan di bawah.";
        // 5. Kirim satu notifikasi konfirmasi sebagai bukti sistem berfungsi.
        const confirmed = await fireConfirmationNotification();
        setMessage(
          confirmed
            ? `✅ ${immediate ? "Sinkronisasi dimulai." : "Monitoring aktif."} Cek notifikasi di HP Anda — pesan konfirmasi akan muncul dalam beberapa detik.${bgNote}`
            : notifGranted
              ? `✅ ${immediate ? "Sinkronisasi dimulai, data 7 hari terakhir akan diimpor." : "Monitoring aktif. Data akan disinkronkan otomatis di background."}${bgNote}`
              : `✅ Monitoring aktif, tapi izin notifikasi sistem ditolak — pembaruan hanya muncul sebagai banner di aplikasi. Aktifkan via Pengaturan > Aplikasi > Relivia > Notifikasi.${bgNote}`
        );
      } else {
        // web: monitoring runs on periodic sync while the app is open.
        setMonitoringActive(true);
        setMessage(
          "✅ Monitoring aktif. Data kesehatan akan disinkronkan otomatis dan Anda akan diberi tahu bila ada perubahan penting."
        );
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setMessage(
        text.startsWith("Aplikasi pendamping") ||
        text.startsWith("Data kesehatan") ||
        text.startsWith("Layar izin") ||
        text.startsWith("Izin akses")
          ? text
          : `Gagal mengaktifkan monitoring: ${text}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-[20px] bg-[#8B5CF6] text-white p-5 mb-4 shadow-pop">

      {/* watermark */}
      <Image
        src="/images/icons/monitoring.svg"
        alt=""
        width={180}
        height={180}
        className="absolute -right-6 pointer-events-none select-none"
      />

      {/* content above the watermark */}
      <div className="relative z-10">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/75 mb-1">
          Automatic Monitoring
        </div>
        <div className="text-[20px] leading-tight font-extrabold mb-1.5">
          {monitoringActive ? "Monitoring Aktif" : "Monitoring Belum Aktif"}
        </div>

        <p className="text-[12px] leading-relaxed text-white/90 mb-3.5">
          {native === true && available === false
            ? sdkStatus === 3
              ? "Aplikasi pendamping kesehatan perlu diperbarui dari Play Store sebelum bisa dihubungkan."
              : "Data kesehatan belum tersedia di perangkat ini. Pastikan aplikasi pendamping kesehatan sudah terpasang dan memiliki data, lalu coba lagi."
            : "Menghubungkan akses ke Health Connect dan notifikasi sistem, dan menjadwalkan sinkronisasi otomatis tiap 6 jam."}
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={handleConnect}
            disabled={busy}
            className="text-[12px] font-bold px-4 py-2 rounded-full bg-[#F9C6DD] text-[#6D28D9] hover:brightness-95 transition disabled:opacity-60 text-left"
          >
            {busy ? "Memproses…" : monitoringActive ? "Sinkronkan Data Kesehatan" : "Hubungkan Health Connect"}
          </button>
        </div>

        {native && showSettingsFallback && (
          <button
            onClick={() => openHealthSettings()}
            className="mt-2 text-[12px] font-bold px-4 py-2 rounded-full bg-white/20 text-white hover:bg-white/30 transition"
          >
            ⚙️ Buka Pengaturan Kesehatan
          </button>
        )}

        {message && (
          <div
            className={`text-[12px] font-medium rounded-xl px-4 py-2.5 mt-3 ${
              message.startsWith("✅")
                ? "bg-white/95 text-[#166534]"
                : "bg-[#FFF1C1] text-[#7A4A00]"
            }`}
          >
            {message}
          </div>
        )}
      </div>
    </div>
  );
}