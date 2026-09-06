"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAutoMonitor } from "@/components/AutoMonitorProvider";
import {
  backendBaseUrl,
  enableBackgroundSync,
  getAppVersion,
  healthAvailability,
  isNative,
  openHealthSettings,
  openNotificationSettings,
  requestHealthPermissions,
  requestNotificationPermission,
} from "@/lib/nativeBridge";

/**
 * Monitoring onboarding card (PRD §10):
 *
 *   Connect Health Data → Health Connect permission →
 *   Notification permission → Background sync → Monitoring Active
 *
 * If Health Connect is unavailable the card reports
 * "Monitoring health data unavailable" — caregiver check-in and all other
 * features keep working (graceful degradation).
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

  // Web build marker — bump when this file's flow changes so a mismatch
  // between installed APK and deployed web is visible at a glance.
  const WEB_BUILD = "2026-09-06d";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const n = await isNative();
      if (cancelled) return;
      setNative(n);
      if (n) {
        try {
          const a = await healthAvailability();
          if (!cancelled) {
            setAvailable(a?.available ?? false);
            setSdkStatus(a?.sdkStatus ?? null);
          }
        } catch {
          if (!cancelled) setAvailable(false);
        }
        try {
          const v = await getAppVersion();
          if (!cancelled) setAppVersion(v);
        } catch {
          /* old APK without the method */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Map native rejection messages to actionable Indonesian guidance. */
  function healthErrorMessage(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("PERMISSION_TIMEOUT")) {
      return "Layar izin Health Connect tidak memberi respons. Tutup layar izin bila masih terbuka, lalu tekan Connect lagi — atau aktifkan izin manual lewat tombol Pengaturan di bawah.";
    }
    if (msg.includes("needs an update")) {
      return "Aplikasi Health Connect perlu diupdate dari Play Store, lalu coba lagi.";
    }
    if (msg.includes("not available on this device") || msg === "Monitoring health data unavailable") {
      return "Monitoring health data unavailable — pastikan aplikasi Health Connect terinstall (Android 13 ke bawah wajib install dari Play Store, Android 14+ bawaan). Check-in harian tetap berfungsi.";
    }
    if (msg.includes("Could not open")) {
      return "Layar izin Health Connect tidak bisa dibuka otomatis. Buka Pengaturan manual lewat tombol di bawah, aktifkan izin baca Tidur/Langkah/Detak jantung untuk Relivia.";
    }
    return `Gagal mengaktifkan monitoring: ${msg}`;
  }

  /** Fire one real system notification as proof it works (best effort). */
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
    setBusy(true);
    setMessage(null);
    setShowSettingsFallback(false);
    try {
      const onNative = await isNative();

      if (onNative) {
        // Request Android 13+ notification permission FIRST so system notifications work
        // regardless of Health Connect outcome
        const notifGranted = await requestNotificationPermission();

        // 1. Health Connect permission (explicit, PRD §10)
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
            `Izin Health Connect belum lengkap. Buka Pengaturan, aktifkan semua izin baca untuk Relivia, lalu tekan Connect lagi.${
              !notifGranted ? " (Izin notifikasi sistem HP juga belum diaktifkan)." : ""
            }`
          );
          return;
        }
        // 3. Schedule background worker with the caregiver's session token
        //    (worker authenticates via Authorization: Bearer, PRD §11).
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Sesi login tidak ditemukan. Login ulang.");
        const scheduled = await enableBackgroundSync({
          backendUrl: backendBaseUrl(),
          patientId,
          token,
        });
        if (!scheduled) throw new Error("Gagal menjadwalkan background sync.");
        setMonitoringActive(true);
        // 4. Prove system notifications work right away.
        const confirmed = await fireConfirmationNotification();
        setMessage(
          confirmed
            ? "✅ Monitoring aktif. Cek notifikasi sistem HP — seharusnya muncul konfirmasi dalam beberapa detik."
            : notifGranted
              ? "✅ Monitoring aktif. Data akan disinkronkan otomatis di background."
              : "✅ Monitoring aktif, tapi izin notifikasi sistem ditolak — investigasi hanya muncul sebagai banner di aplikasi. Aktifkan via Pengaturan > Aplikasi > Relivia > Notifikasi."
        );
      } else {
        // Web demo: no native layer — monitoring runs via manual/simulation sync.
        setMonitoringActive(true);
        setMessage(
          "✅ Monitoring simulasi aktif di browser. Di APK Android, langkah ini akan menghubungkan Health Connect asli."
        );
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setMessage(
        text.startsWith("Aplikasi Health Connect") ||
        text.startsWith("Monitoring health data unavailable") ||
        text.startsWith("Layar izin") ||
        text.startsWith("Izin Health Connect")
          ? text
          : `Gagal mengaktifkan monitoring: ${text}`
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestNotifOnly() {
    setBusy(true);
    try {
      const granted = await requestNotificationPermission();
      if (granted) {
        const confirmed = await fireConfirmationNotification();
        setMessage(
          confirmed
            ? "✅ Izin notifikasi sistem berhasil diaktifkan!"
            : "✅ Izin notifikasi sistem diizinkan."
        );
      } else {
        setMessage(
          "⚠️ Izin notifikasi ditolak oleh sistem. Buka Pengaturan > Aplikasi > Relivia > Notifikasi untuk mengaktifkan manual."
        );
      }
    } catch (e) {
      setMessage(`Gagal meminta izin notifikasi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-faint mb-1">
            Automatic Monitoring
          </div>
          <div className="font-extrabold">
            {monitoringActive ? "🟢 Monitoring Aktif" : "⚪ Monitoring Belum Aktif"}
          </div>
        </div>
        {!monitoringActive && (
          <button
            onClick={handleConnect}
            disabled={busy}
            className="text-sm font-bold px-5 py-2.5 rounded-xl bg-primary text-white hover:bg-primary-dark transition disabled:opacity-60"
          >
            {busy ? "Menghubungkan…" : "🔗 Connect Health Data"}
          </button>
        )}
      </div>

      <p className="text-xs text-soft leading-relaxed">
        {native === true && available === false
          ? sdkStatus === 3
            ? "Health Connect perlu diupdate dari Play Store sebelum bisa dihubungkan."
            : "Health Connect tidak tersedia di perangkat ini. Install aplikasi Health Connect dari Play Store (wajib di Android 13 ke bawah), pastikan ada data, lalu coba lagi."
          : native === true
            ? "Menghubungkan akan meminta izin Health Connect, izin notifikasi sistem, dan menjadwalkan sinkronisasi background tiap 6 jam."
            : "Kamu membuka Relivia di browser: sinkronisasi berjalan saat halaman /health dibuka atau lewat tombol simulasi. Di APK Android, sinkronisasi berjalan otomatis di background via Health Connect."}
      </p>

      {native && (
        <div className="flex gap-2 flex-wrap mt-3">
          {showSettingsFallback && (
            <button
              onClick={() => openHealthSettings()}
              className="text-xs font-semibold px-3.5 py-2 rounded-xl border border-border hover:border-primary/40 transition"
            >
              ⚙️ Buka Pengaturan Health Connect
            </button>
          )}
          <button
            onClick={handleRequestNotifOnly}
            disabled={busy}
            className="text-xs font-semibold px-3.5 py-2 rounded-xl border border-border hover:border-primary/40 transition"
          >
            🔔 Minta Izin Notifikasi Sistem
          </button>
          <button
            onClick={() => openNotificationSettings()}
            className="text-xs font-semibold px-3.5 py-2 rounded-xl border border-border hover:border-primary/40 transition"
          >
            ⚙️ Buka Pengaturan Notifikasi HP
          </button>
        </div>
      )}

      {native && (
        <div className="mt-3 text-[11px] text-faint">
          Aplikasi v{appVersion ?? "?"} • Web {WEB_BUILD}
          {appVersion === null && " — APK lama terdeteksi, install ulang APK terbaru"}
        </div>
      )}

      {message && (
        <div
          className={`text-sm rounded-xl px-4 py-3 mt-3 ${
            message.startsWith("✅")
              ? "bg-green-tint text-green-deep"
              : "bg-amber-tint text-amber-deep"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}
