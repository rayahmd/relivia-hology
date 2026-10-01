"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useAutoMonitor } from "@/components/AutoMonitorProvider";
import {
  backendBaseUrl,
  checkHealthPermissions,
  enableBackgroundSync,
  syncNow,
  getAppVersion,
  getManualSyncState,
  healthAvailability,
  isNative,
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
  const [syncing, setSyncing] = useState(false);
  /** actual Health Connect permission state (null = unknown yet). */
  const [connected, setConnected] = useState<boolean | null>(null);
  /** synchronous click lock — state alone can't stop same-frame double taps. */
  const lockRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
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
          // restore the connected state from the actual granted set,
          // so a relaunch shows "Health Connect Terhubung" with no taps.
          (async () => {
            const p = await checkHealthPermissions();
            if (cancelled || !p) return;
            setConnected(p.allGranted);
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

  /** block until the manual worker reaches idle (ceiling: never lock forever). */
  async function waitForSyncIdle(timeoutMs = 180_000): Promise<boolean> {
    const start = Date.now();
    for (;;) {
      let s: string;
      try {
        s = await getManualSyncState();
      } catch {
        s = "enqueued";
      }
      if (s === "idle") return true;
      if (Date.now() - start > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  async function handleConnect() {
    // synchronous lock: setBusy(true) alone doesn't land before a
    // second tap in the same frame, so rapid presses can never start
    // two flows. connected never gates — only busy/syncing disable.
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const onNative = await isNative();

      if (!onNative) {
        // web: monitoring runs on periodic sync while the app is open.
        setMonitoringActive(true);
        setMessage(
          "✅ Monitoring aktif. Data kesehatan akan disinkronkan otomatis dan Anda akan diberi tahu bila ada perubahan penting."
        );
        return;
      }

      // source of truth: the actual granted set, never a local flag.
      const snapshot = await checkHealthPermissions().catch(() => null);
      let isConnected = snapshot?.allGranted ?? connected === true;
      let granted = snapshot?.granted ?? [];
      let notifGranted = true;
      const wentThroughConnect = !isConnected;

      if (!isConnected) {
        // notification permission first, so system notifications keep
        // working whatever the health-data result is.
        notifGranted = await requestNotificationPermission();

        // permission request. already-granted → native fast path
        // resolves with no screen; partial → screen to fix missing.
        let perm;
        try {
          perm = await requestHealthPermissions();
        } catch (e) {
          throw new Error(healthErrorMessage(e));
        }
        if (!perm.allGranted) {
          setConnected(false);
          setMessage(
            `Izin akses data kesehatan belum lengkap. Buka Pengaturan, aktifkan semua izin baca untuk Relivia, lalu tekan Hubungkan lagi.${
              !notifGranted ? " (Izin notifikasi sistem juga belum diaktifkan.)" : ""
            }`
          );
          return;
        }
        // permission result returned → refresh actual state now.
        granted = perm.granted ?? [];
        isConnected = true;
        setConnected(true);
      }
      // connected (new or returning): straight to sync, no permission
      // screen. token + periodic schedule first (fresh token each tap),
      // then exactly one manual worker (native rejects duplicates).
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
      const { enqueued, alreadyRunning } = await syncNow({
        backendUrl: backendBaseUrl(),
        patientId,
        token,
      }).catch(() => ({ enqueued: false, alreadyRunning: false }));
      // background access verified separately — never gates sync.
      const hasBackground = granted.includes(HEALTH_BACKGROUND_PERMISSION);
      const bgNote = hasBackground
        ? ""
        : " Untuk sinkronisasi otomatis, aktifkan juga akses background di pengaturan Health Connect.";
      setMonitoringActive(true);
      if (!enqueued && !alreadyRunning) {
        // native call failed and nothing is running: periodic covers it.
        setMessage(`✅ Monitoring aktif. Data akan disinkronkan otomatis di background.${bgNote}`);
        return;
      }
      // one active worker (ours or another tap's): lock the button and
      // wait for idle instead of enqueueing again.
      setSyncing(true);
      const finished = await waitForSyncIdle();
      setSyncing(false);
      if (wentThroughConnect) {
        // proof notification for the fresh-connect flow only.
        const confirmed = await fireConfirmationNotification();
        setMessage(
          finished
            ? `✅ Monitoring aktif, sinkronisasi 7 hari terakhir selesai.${confirmed ? " Cek notifikasi di HP Anda." : ""}${!notifGranted ? " Aktifkan izin notifikasi via Pengaturan > Aplikasi > Relivia > Notifikasi." : ""}${bgNote}`
            : `⏳ Monitoring aktif, sinkronisasi masih berjalan di background dan akan selesai otomatis.${bgNote}`
        );
      } else {
        setMessage(
          finished
            ? `✅ Sinkronisasi selesai, data 7 hari terakhir telah diimpor.${bgNote}`
            : `⏳ Sinkronisasi masih berjalan di background dan akan selesai otomatis.${bgNote}`
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
      lockRef.current = false;
      setBusy(false);
      setSyncing(false);
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
          {connected ? (
            // connected = status only, non-clickable so it can't spam sync.
            <span className="text-[12px] font-bold px-4 py-2 rounded-full bg-[#F9C6DD] text-[#6D28D9] text-left">
              Health Connect Terhubung
            </span>
          ) : (
            <button
              onClick={handleConnect}
              disabled={busy || syncing}
              className="text-[12px] font-bold px-4 py-2 rounded-full bg-[#F9C6DD] text-[#6D28D9] hover:brightness-95 transition disabled:opacity-60 text-left"
            >
              {syncing ? "Menyinkronkan…" : busy ? "Memproses…" : "Hubungkan Health Connect"}
            </button>
          )}
        </div>

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