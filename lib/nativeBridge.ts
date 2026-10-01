/**
 * Relivia native bridge.
 *
 * Single entry point from Next.js to Capacitor native capabilities:
 * Health Connect, background worker, notification, permissions, deep link.
 *
 * - On Android native: talks to ReliviaHealthPlugin (Kotlin) and
 *   @capacitor/local-notifications for REAL OS notifications.
 * - On web: every method degrades gracefully to simulation / no-op so the
 *   app stays fully usable in the browser.
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
  syncNow: (opts: {
    backendUrl: string;
    patientId: string;
    token: string;
  }) => Promise<{ enqueued: boolean }>;
  notifyAgent: (opts: { type: string; sessionId: string }) => Promise<{ notified: boolean }>;
  getAppVersion: () => Promise<{ version: string; versionCode: number }>;
  openNotificationSettings: () => Promise<{ opened: boolean }>;
  checkNotificationPermission: () => Promise<{ granted: boolean }>;
  requestNotificationPermission: () => Promise<{ granted: boolean }>;
  openHealthSettings: () => Promise<{ opened: boolean }>;
};

let capacitorModule: typeof import("@capacitor/core") | null = null;
let pluginCache: ReliviaHealthPluginApi | null = null;
let pluginAttempted = false;

/** console-only diagnostics, never changes behavior or ui. */
function dlog(...args: unknown[]): void {
  try {
    // eslint-disable-next-line no-console
    console.debug("[ReliviaBridge]", ...args);
  } catch {
    /* logging must never break the bridge */
  }
}

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

/** true inside the android apk (capacitor native). */
export async function isNative(): Promise<boolean> {
  const cap = await loadCapacitor();
  if (!cap) {
    dlog("native detected: false (no @capacitor/core)");
    return false;
  }
  try {
    const native = cap.Capacitor.isNativePlatform();
    dlog("native detected:", native);
    return native;
  } catch (e) {
    dlog("native detected: error", e instanceof Error ? e.message : e);
    return false;
  }
}

/** sync best-effort check (ssr safe, true only inside the apk). */
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

/**
 * initialize the native plugin proxy once and report readiness as a plain
 * boolean. The boolean (never the proxy) crosses the await boundary.
 *
 * why: Capacitor's registerPlugin() returns a Proxy whose `get` trap
 * returns a method wrapper for ANY property — including `then`. Awaiting
 * a promise that resolves to that proxy makes the engine call proxy.then(),
 * which Capacitor translates into a native call for a method literally
 * named "then" → unhandled rejection AND the outer await never settles.
 */
let pluginReady: Promise<boolean> | null = null;

function ensurePlugin(): Promise<boolean> {
  if (!pluginReady) {
    pluginReady = (async () => {
      const cap = await loadCapacitor();
      if (!cap || !cap.Capacitor.isNativePlatform()) return false;
      try {
        const { registerPlugin } = await import("@capacitor/core");
        pluginCache = registerPlugin<ReliviaHealthPluginApi>("ReliviaHealth");
        dlog("plugin registered: ReliviaHealth");
        return true;
      } catch (e) {
        dlog("plugin register failed:", e instanceof Error ? e.message : e);
        return false;
      }
    })();
  }
  return pluginReady;
}

/**
 * sync accessor for the cached proxy. never await this (or any value
 * holding the proxy) — awaiting a thenable proxy invokes its `.then`
 * trap and hangs. always `await ensurePlugin()` first, then call this.
 */
function getPlugin(): ReliviaHealthPluginApi | null {
  return pluginCache;
}

/** health connect availability. null on web. sdkStatus passthrough
 * lets the ui explain why it is unavailable.
 * sdk codes: 1 = available, 2 = unavailable, 3 = update required. */
export async function healthAvailability(): Promise<{
  available: boolean;
  sdkStatus?: number;
} | null> {
  await ensurePlugin();
  const plugin = getPlugin();
  if (!plugin) return null;
  try {
    const res = await withTimeout(plugin.isAvailable(), 4000, "isAvailable");
    dlog("isAvailable result:", JSON.stringify(res));
    return { available: res.available, sdkStatus: res.sdkStatus };
  } catch (e) {
    dlog("isAvailable error:", e instanceof Error ? e.message : e);
    return { available: false };
  }
}

/**
 * explicit permission request. throws with a user-friendly message when
 * unavailable — callers show "monitoring unavailable" but keep the rest
 * of the app working.
 *
 * guarded by a timeout: if the health connect screen never returns (a
 * device-specific quirk), the promise rejects instead of hanging the ui
 * forever — callers then offer the manual settings fallback.
 */
export async function requestHealthPermissions(): Promise<{
  granted: string[];
  allGranted: boolean;
}> {
  await ensurePlugin();
  const plugin = getPlugin();
  if (!plugin) {
    dlog("requestHealthPermissions: no plugin (web)");
    throw new Error("Monitoring health data unavailable");
  }
  dlog("requestHealthPermissions calling native");
  const TIMEOUT_MS = 7_000;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("PERMISSION_TIMEOUT")), TIMEOUT_MS)
  );
  try {
    const res = await Promise.race([plugin.requestHealthPermissions(), timeout]);
    dlog("requestHealthPermissions result:", JSON.stringify(res));
    return res;
  } catch (e) {
    dlog("requestHealthPermissions error:", e instanceof Error ? e.message : e);
    throw e;
  }
}

export type AppVersion = {
  version: string;
  versionCode: number;
};

/** apk version (null only on web — native always resolves or throws). */
export async function getAppVersion(): Promise<AppVersion | null> {
  await ensurePlugin();
  const plugin = getPlugin();
  if (!plugin) {
    dlog("getAppVersion: no plugin (web)");
    return null;
  }
  if (typeof plugin.getAppVersion !== "function") {
    dlog("getAppVersion error: BRIDGE_NO_GETAPPVERSION");
    throw new Error("BRIDGE_NO_GETAPPVERSION");
  }
  dlog("getAppVersion calling native");
  try {
    const res = await withTimeout(plugin.getAppVersion(), 2500, "getAppVersion");
    dlog("getAppVersion result:", JSON.stringify(res));
    if (!res || typeof res.version !== "string") return null;
    return {
      version: res.version,
      versionCode: typeof res.versionCode === "number" ? res.versionCode : -1,
    };
  } catch (e) {
    dlog("getAppVersion error:", e instanceof Error ? e.message : e);
    throw e;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(timer)), timeout]) as Promise<T>;
}

/** read recent health data. null on web (caller falls back to simulation). */
export async function readHealth(daysBack = 1): Promise<NativeHealthPoint[] | null> {
  await ensurePlugin();
  const plugin = getPlugin();
  if (!plugin) return null;
  const res = await plugin.readHealth({ daysBack });
  return res.data ?? [];
}

/** schedule the periodic workmanager sync. no-op on web. */
export async function enableBackgroundSync(opts: {
  backendUrl: string;
  patientId: string;
  token: string;
}): Promise<boolean> {
  await ensurePlugin();
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    const res = await plugin.enableBackgroundSync(opts);
    return res.scheduled;
  } catch {
    return false;
  }
}

export async function disableBackgroundSync(): Promise<void> {
  await ensurePlugin();
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.disableBackgroundSync();
  } catch {
    /* ignore */
  }
}

/** background-read permission string, as reported inside the granted set. */
export const HEALTH_BACKGROUND_PERMISSION =
  "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND";

/**
 * one-shot immediate sync (last 7 days via HealthSyncWorker). no-op on
 * web, false when the native call fails — the periodic worker still
 * covers the sync in that case.
 */
export async function syncNow(opts: {
  backendUrl: string;
  patientId: string;
  token: string;
}): Promise<boolean> {
  await ensurePlugin();
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    const res = await plugin.syncNow(opts);
    return res.enqueued;
  } catch {
    return false;
  }
}

/**
 * show the agent notification immediately (foreground-sync path).
 *
 * - native android: real os notification via @capacitor/local-notifications
 *   on channel "relivia-monitoring" (high, heads-up). never the browser
 *   notification api. returns true only when actually scheduled.
 * - browser: notification api fallback (permission permitting).
 * body text identical in both paths, never containing the agent question.
 */
export async function notifyAgent(opts: { type: string; sessionId: string }): Promise<boolean> {
  await ensurePlugin();
  const plugin = getPlugin();
  if (plugin) {
    return notifyAgentNative(opts.type, opts.sessionId);
  }
  // web fallback: notification api (best effort, silent if denied)
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
 * create (idempotent) the android channel for agent triggers.
 * importance 4 = high → heads-up. sound from res/raw.
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
 * post a real android system notification for an agent trigger.
 * returns true only when the os accepted the schedule. never resolves
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
          // inexact alarm: avoids the "alarms & reminders" settings detour
          // on android 12+ for an immediate notification.
          isExactNotification: false,
          // heads-up even when the app is foregrounded.
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
  await ensurePlugin();
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.openHealthSettings();
  } catch {
    /* ignore */
  }
}

/** open the app's os notification settings screen (manual fallback). */
export async function openNotificationSettings(): Promise<void> {
  await ensurePlugin();
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.openNotificationSettings();
  } catch {
    /* ignore */
  }
}

/**
 * android 13+ runtime notification permission.
 * returns true when system notifications are allowed (or on web /
 * pre-13 devices where no runtime grant is needed). null plugin → false.
 */
export async function checkNotificationPermission(): Promise<boolean> {
  await ensurePlugin();
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    dlog("checkNotificationPermission calling native");
    const res = await withTimeout(plugin.checkNotificationPermission(), 4000, "checkNotificationPermission");
    dlog("checkNotificationPermission result:", JSON.stringify(res));
    return res.granted;
  } catch (e) {
    dlog("checkNotificationPermission error:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** prompt the android 13+ notification permission dialog. */
export async function requestNotificationPermission(): Promise<boolean> {
  const ask = async (): Promise<boolean> => {
    // 1. Try custom plugin first for direct Android permission request
    await ensurePlugin();
    const plugin = getPlugin();
    if (plugin) {
      try {
        dlog("requestNotificationPermission calling native");
        const res = await withTimeout(plugin.requestNotificationPermission(), 30000, "requestNotificationPermission");
        dlog("requestNotificationPermission result:", JSON.stringify(res));
        if (res.granted) return true;
      } catch (e) {
        dlog("requestNotificationPermission error:", e instanceof Error ? e.message : e);
        /* fallback */
      }
    }
    // 2. Try official Capacitor LocalNotifications plugin request
    try {
      dlog("requestNotificationPermission: trying LocalNotifications fallback");
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const status = await LocalNotifications.requestPermissions();
      dlog("requestNotificationPermission fallback result:", JSON.stringify(status));
      return status.display === "granted";
    } catch (e) {
      dlog("requestNotificationPermission fallback error:", e instanceof Error ? e.message : e);
      return false;
    }
  };

  // generous ceiling: the caregiver needs time to read and answer the os
  // dialog. a short cutoff here used to silently report "denied" while the
  // dialog was still open.
  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => {
      dlog("requestNotificationPermission: outer timeout, reporting false");
      resolve(false);
    }, 65_000)
  );
  return Promise.race([ask(), timeout]);
}

/** backend base url for the native worker (no trailing slash). */
export function backendBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}
