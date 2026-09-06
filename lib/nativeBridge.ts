/**
 * Relivia native bridge (PRD §7–§8).
 *
 * Single entry point from Next.js to Capacitor native capabilities:
 * Health Connect, background worker, notification, permissions, deep link.
 *
 * - On Android native: talks to ReliviaHealthPlugin (Kotlin) and
 *   @capacitor/local-notifications for REAL OS notifications.
 * - On web: every method degrades gracefully to simulation / no-op so the
 *   app stays fully usable in the browser (PRD §10: monitoring unavailable
 *   must not break check-in and other features).
 */

import {
  NOTIFICATION_CHANNEL_ID,
  NOTIFICATION_CHANNEL_NAME,
  NOTIFICATION_SOUND,
  stableNotificationId,
  type NotificationType,
} from "@/lib/notify";

export type NativeHealthPoint = {
  dataType: string;
  value: number;
  unit: string;
  recordedAt: string; // yyyy-MM-dd
};

type ReliviaHealthPluginApi = {
  isAvailable: () => Promise<{ available: boolean; sdkStatus?: number }>;
  requestHealthPermissions: () => Promise<{ granted: string[]; allGranted: boolean }>;
  readHealth: (opts: { daysBack?: number }) => Promise<{ data: NativeHealthPoint[] }>;
  enableBackgroundSync: (opts: {
    backendUrl: string;
    patientId: string;
    token: string;
  }) => Promise<{ scheduled: boolean }>;
  disableBackgroundSync: () => Promise<{ scheduled: boolean }>;
  notifyAgent: (opts: { type: string; sessionId: string }) => Promise<{ notified: boolean }>;
  getAppVersion: () => Promise<{ version: string }>;
  checkNotificationPermission: () => Promise<{ granted: boolean }>;
  requestNotificationPermission: () => Promise<{ granted: boolean }>;
  openHealthSettings: () => Promise<{ opened: boolean }>;
  openNotificationSettings: () => Promise<{ opened: boolean }>;
};

let capacitorModule: typeof import("@capacitor/core") | null = null;
let pluginCache: ReliviaHealthPluginApi | null = null;
let pluginAttempted = false;

async function loadCapacitor() {
  if (capacitorModule || pluginAttempted) return capacitorModule;
  pluginAttempted = true;
  try {
    capacitorModule = await import("@capacitor/core");
  } catch {
    capacitorModule = null;
  }
  return capacitorModule;
}

/** True when running inside the Android APK (Capacitor native). */
export async function isNative(): Promise<boolean> {
  const cap = await loadCapacitor();
  if (!cap) return false;
  try {
    return cap.Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Synchronous best-effort check (SSR safe, true only inside the APK). */
export function isNativeSync(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
        .Capacitor?.isNativePlatform?.() === true
    );
  } catch {
    return false;
  }
}

async function getPlugin(): Promise<ReliviaHealthPluginApi | null> {
  if (pluginCache) return pluginCache;
  const cap = await loadCapacitor();
  if (!cap || !cap.Capacitor.isNativePlatform()) return null;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    pluginCache = registerPlugin<ReliviaHealthPluginApi>("ReliviaHealth");
    return pluginCache;
  } catch {
    return null;
  }
}

/** Health Connect availability (PRD §9). Null on web. sdkStatus passthrough
 * lets the UI explain WHY it is unavailable (not installed vs needs update).
 * SDK status codes: 1 = available, 2 = unavailable, 3 = update required. */
export async function healthAvailability(): Promise<{
  available: boolean;
  sdkStatus?: number;
} | null> {
  const plugin = await getPlugin();
  if (!plugin) return null;
  try {
    const res = await plugin.isAvailable();
    return { available: res.available, sdkStatus: res.sdkStatus };
  } catch {
    return { available: false };
  }
}

/**
 * Explicit permission request (PRD §10).
 * Throws with user-friendly message when unavailable — callers show
 * "Monitoring health data unavailable" but keep the rest of the app working.
 *
 * Guarded by a timeout: if the Health Connect screen never returns a
 * result (device-specific quirk), the promise rejects instead of hanging
 * the UI forever — callers then offer the manual settings fallback.
 */
export async function requestHealthPermissions(): Promise<{
  granted: string[];
  allGranted: boolean;
}> {
  const plugin = await getPlugin();
  if (!plugin) throw new Error("Monitoring health data unavailable");
  const TIMEOUT_MS = 7_000;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("PERMISSION_TIMEOUT")), TIMEOUT_MS)
  );
  return Promise.race([plugin.requestHealthPermissions(), timeout]);
}

/** APK versionName (null on web or on old APKs without the method). */
export async function getAppVersion(): Promise<string | null> {
  const plugin = await getPlugin();
  if (!plugin) return null;
  if (typeof plugin.getAppVersion !== "function") {
    throw new Error("BRIDGE_NO_GETAPPVERSION");
  }
  const res = await plugin.getAppVersion();
  return res.version ?? null;
}

/** Read recent health data. Returns null on web (caller falls back to simulation). */
export async function readHealth(daysBack = 1): Promise<NativeHealthPoint[] | null> {
  const plugin = await getPlugin();
  if (!plugin) return null;
  const res = await plugin.readHealth({ daysBack });
  return res.data ?? [];
}

/** Schedule the periodic WorkManager sync (PRD §11). No-op on web. */
export async function enableBackgroundSync(opts: {
  backendUrl: string;
  patientId: string;
  token: string;
}): Promise<boolean> {
  const plugin = await getPlugin();
  if (!plugin) return false;
  try {
    const res = await plugin.enableBackgroundSync(opts);
    return res.scheduled;
  } catch {
    return false;
  }
}

export async function disableBackgroundSync(): Promise<void> {
  const plugin = await getPlugin();
  if (!plugin) return;
  try {
    await plugin.disableBackgroundSync();
  } catch {
    /* ignore */
  }
}

/**
 * Show the agent notification immediately (foreground-sync path).
 *
 * - Native Android: REAL OS notification via @capacitor/local-notifications
 *   on channel "relivia-monitoring" (HIGH, heads-up). Never the browser
 *   Notification API. Returns true only when actually scheduled.
 * - Browser: Notification API fallback (permission permitting).
 * Body text identical in both paths (PRD §21–22), never containing the
 * agent question itself.
 */
export async function notifyAgent(opts: { type: string; sessionId: string }): Promise<boolean> {
  const plugin = await getPlugin();
  if (plugin) {
    return notifyAgentNative(opts.type, opts.sessionId);
  }
  // Web fallback: Notification API (best effort, silent if denied)
  try {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        const body =
          opts.type === "agent_question"
            ? "Perubahan pada pola pasien terdeteksi. Relivia membutuhkan konteks tambahan untuk melanjutkan analisis. Tap untuk melihat."
            : "Relivia menemukan insight baru tentang pola pasien. Tap untuk melihat.";
        const n = new Notification("Relivia", { body });
        n.onclick = () => {
          window.location.href = `/agent?session=${opts.sessionId}`;
        };
        return true;
      }
      if (Notification.permission === "default") {
        await Notification.requestPermission();
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Create (idempotent) the Android channel for agent triggers.
 * importance 4 = HIGH → heads-up. Sound from res/raw.
 */
export async function ensureMonitoringChannel(): Promise<boolean> {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.createChannel({
      id: NOTIFICATION_CHANNEL_ID,
      name: NOTIFICATION_CHANNEL_NAME,
      description: "Pemberitahuan investigasi dan insight Relivia",
      importance: 4,
      sound: NOTIFICATION_SOUND,
      vibration: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Post a REAL Android system notification for an agent trigger.
 * Returns true only when the OS accepted the schedule. Never resolves
 * true on permission denial (callers fall back to the in-app banner).
 */
export async function notifyAgentNative(type: string, sessionId: string): Promise<boolean> {
  try {
    if (!(await checkNotificationPermission())) return false;
    await ensureMonitoringChannel();
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const nType = (type === "insight_ready" ? "insight_ready" : "agent_question") as NotificationType;
    const title = "Relivia";
    const body =
      nType === "agent_question"
        ? "Perubahan pada pola pasien terdeteksi. Relivia membutuhkan konteks tambahan untuk melanjutkan analisis."
        : "Relivia menemukan insight baru tentang pola pasien.";
    await LocalNotifications.schedule({
      notifications: [
        {
          title,
          body,
          id: stableNotificationId(nType, sessionId),
          schedule: { at: new Date(Date.now() + 500) },
          channelId: NOTIFICATION_CHANNEL_ID,
          extra: { type: nType, sessionId },
          autoCancel: true,
          // Inexact alarm: avoids the "Alarms & reminders" settings detour
          // on Android 12+ for an immediate notification.
          isExactNotification: false,
          // Heads-up presentation even when the app is foregrounded.
          foreground: true,
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

export async function openHealthSettings(): Promise<void> {
  const plugin = await getPlugin();
  if (!plugin) return;
  try {
    await plugin.openHealthSettings();
  } catch {
    /* ignore */
  }
}

export async function openNotificationSettings(): Promise<void> {
  const plugin = await getPlugin();
  if (!plugin) return;
  try {
    await plugin.openNotificationSettings();
  } catch {
    /* ignore */
  }
}

/**
 * Android 13+ runtime notification permission (PRD §10).
 * Returns true when system notifications are allowed (or on web /
 * pre-13 devices where no runtime grant is needed). Null plugin → false.
 */
export async function checkNotificationPermission(): Promise<boolean> {
  const plugin = await getPlugin();
  if (!plugin) return false;
  try {
    const res = await plugin.checkNotificationPermission();
    return res.granted;
  } catch {
    return false;
  }
}

/** Prompt the Android 13+ notification permission dialog. */
export async function requestNotificationPermission(): Promise<boolean> {
  const ask = async (): Promise<boolean> => {
    // 1. Try custom plugin first for direct Android permission request
    const plugin = await getPlugin();
    if (plugin) {
      try {
        const res = await plugin.requestNotificationPermission();
        if (res.granted) return true;
      } catch {
        /* fallback */
      }
    }
    // 2. Try official Capacitor LocalNotifications plugin request
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const status = await LocalNotifications.requestPermissions();
      return status.display === "granted";
    } catch {
      return false;
    }
  };

  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000));
  return Promise.race([ask(), timeout]);
}

/** Backend base URL for the native worker (no trailing slash). */
export function backendBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}
