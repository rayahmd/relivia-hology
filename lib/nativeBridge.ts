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
  getAppVersion: () => Promise<{ version: string; versionCode: number }>;
  openNotificationSettings: () => Promise<{ opened: boolean }>;
  checkNotificationPermission: () => Promise<{ granted: boolean }>;
  requestNotificationPermission: () => Promise<{ granted: boolean }>;
  openHealthSettings: () => Promise<{ opened: boolean }>;
};

let capacitorModule: typeof import("@capacitor/core") | null = null;
let pluginCache: ReliviaHealthPluginApi | null = null;
let pluginAttempted = false;

/** Diagnostic logging: console only, never changes behavior or UI. */
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

/** True when running inside the Android APK (Capacitor native). */
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

/**
 * Initialize the native plugin proxy ONCE and report readiness as a plain
 * boolean. The boolean (never the proxy) crosses the await boundary.
 *
 * WHY: Capacitor's registerPlugin() returns a Proxy whose `get` trap
 * returns a method wrapper for ANY property — including `then`. Awaiting
 * a promise that resolves to that proxy makes the JS engine call
 * proxy.then(), which Capacitor translates into a native call for a
 * method literally named "then" → "ReliviaHealth.then() is not implemented
 * on android" (unhandled rejection) AND the outer await never settles
 * (the wrapper ignores the resolve/reject args) → UI stuck forever.
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
 * Sync accessor for the cached proxy. NEVER await this (or any value
 * holding the proxy) — awaiting a thenable proxy invokes its `.then`
 * trap and hangs. Always `await ensurePlugin()` first, then call this.
 */
function getPlugin(): ReliviaHealthPluginApi | null {
  return pluginCache;
}

/** Health Connect availability (PRD §9). Null on web. sdkStatus passthrough
 * lets the UI explain WHY it is unavailable (not installed vs needs update).
 * SDK status codes: 1 = available, 2 = unavailable, 3 = update required. */
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

/** APK version (null only on web — native always resolves or throws). */
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

/**
 * Every @PluginMethod the current web layer may call. The diagnostics
 * compare this contract against the native PluginHeaders to prove the
 * installed APK bundles the latest plugin (not a stale install).
 * Update this list when a native method is added or renamed.
 */
export const EXPECTED_NATIVE_METHODS = [
  "isAvailable",
  "getAppVersion",
  "requestHealthPermissions",
  "readHealth",
  "enableBackgroundSync",
  "disableBackgroundSync",
  "checkNotificationPermission",
  "requestNotificationPermission",
  "notifyAgent",
  "openHealthSettings",
  "openNotificationSettings",
] as const;

export type BridgeDiagnostics = {
  isNative: boolean;
  /** Raw PluginHeaders injected by native — decisive proof of registration. */
  hasPluginHeader: boolean | null;
  headerMethods: string[] | null;
  headerError: string | null;
  /** Native methods missing from the installed APK (stale install proof). */
  missingMethods: string[];
  sdkStatus: number | null;
  sdkError: string | null;
  appVersion: string | null;
  appVersionCode: number | null;
  appVersionError: string | null;
};

/**
 * Full bridge self-test. Nothing here can hang: header read is sync JS,
 * every native call has a fast timeout. Display the result verbatim —
 * it pinpoints the failing layer (registration vs dispatch vs method).
 */
export async function getBridgeDiagnostics(): Promise<BridgeDiagnostics> {
  const diag: BridgeDiagnostics = {
    isNative: false,
    hasPluginHeader: null,
    headerMethods: null,
    headerError: null,
    missingMethods: [],
    sdkStatus: null,
    sdkError: null,
    appVersion: null,
    appVersionCode: null,
    appVersionError: null,
  };
  try {
    diag.isNative = await isNative();
  } catch (e) {
    diag.headerError = e instanceof Error ? e.message : String(e);
    return diag;
  }
  if (!diag.isNative) return diag;

  // 1. PluginHeaders: injected by native at bridge init from registered
  //    PluginHandles. Absent header = plugin never registered.
  try {
    const w = window as unknown as {
      Capacitor?: { PluginHeaders?: Array<{ name: string; methods: Array<{ name: string }> }> };
    };
    const headers = w.Capacitor?.PluginHeaders;
    if (!Array.isArray(headers)) {
      diag.hasPluginHeader = false;
      diag.headerError = "NO_PLUGIN_HEADERS_ARRAY";
    } else {
      const h = headers.find((x) => x?.name === "ReliviaHealth");
      diag.hasPluginHeader = !!h;
      diag.headerMethods = h ? h.methods.map((m) => m.name) : [];
      if (h) {
        // Prove the installed APK bundles the latest plugin: every method
        // the web layer may call must be exported natively.
        const exported = new Set(diag.headerMethods);
        diag.missingMethods = (EXPECTED_NATIVE_METHODS as readonly string[]).filter(
          (m) => !exported.has(m)
        );
      }
    }
  } catch (e) {
    diag.hasPluginHeader = false;
    diag.headerError = e instanceof Error ? e.message : String(e);
  }

  // 2. isAvailable (2.5s timeout — hang becomes visible error).
  try {
    await ensurePlugin();
    const plugin = getPlugin();
    if (!plugin) {
      diag.sdkError = "NO_PLUGIN_PROXY";
    } else {
      const res = await withTimeout(plugin.isAvailable(), 2500, "isAvailable");
      diag.sdkStatus = res.sdkStatus ?? (res.available ? 1 : -1);
    }
  } catch (e) {
    diag.sdkError = e instanceof Error ? e.message : String(e);
  }

  // 3. getAppVersion (2.5s timeout).
  try {
    const v = await getAppVersion();
    if (v) {
      diag.appVersion = v.version;
      diag.appVersionCode = v.versionCode;
    } else {
      diag.appVersionError = "NULL_VERSION";
    }
  } catch (e) {
    diag.appVersionError = e instanceof Error ? e.message : String(e);
  }

  return diag;
}

/** Read recent health data. Returns null on web (caller falls back to simulation). */
export async function readHealth(daysBack = 1): Promise<NativeHealthPoint[] | null> {
  await ensurePlugin();
  const plugin = getPlugin();
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
  await ensurePlugin();
  const plugin = getPlugin();
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
  await ensurePlugin();
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.openHealthSettings();
  } catch {
    /* ignore */
  }
}

/** Open the app's OS notification settings screen (manual fallback). */
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
 * Android 13+ runtime notification permission (PRD §10).
 * Returns true when system notifications are allowed (or on web /
 * pre-13 devices where no runtime grant is needed). Null plugin → false.
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

/** Prompt the Android 13+ notification permission dialog. */
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

  // Generous ceiling: the caregiver needs time to read and answer the OS
  // dialog. (A short cutoff here used to silently report "denied" while the
  // dialog was still open — one cause of the unreliable permission flow.)
  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => {
      dlog("requestNotificationPermission: outer timeout, reporting false");
      resolve(false);
    }, 65_000)
  );
  return Promise.race([ask(), timeout]);
}

/** Backend base URL for the native worker (no trailing slash). */
export function backendBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}
