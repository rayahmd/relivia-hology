/**
 * Relivia native bridge (PRD §7–§8).
 *
 * Single entry point from Next.js to Capacitor native capabilities:
 * Health Connect, background worker, notification, permissions, deep link.
 *
 * - On Android native: talks to ReliviaHealthPlugin (Kotlin).
 * - On web: every method degrades gracefully to simulation / no-op so the
 *   app stays fully usable in the browser (PRD §10: monitoring unavailable
 *   must not break check-in and other features).
 */

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
  openHealthSettings: () => Promise<{ opened: boolean }>;
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

/** Health Connect availability (PRD §9). Null on web. */
export async function healthAvailability(): Promise<{ available: boolean } | null> {
  const plugin = await getPlugin();
  if (!plugin) return null;
  try {
    const res = await plugin.isAvailable();
    return { available: res.available };
  } catch {
    return { available: false };
  }
}

/**
 * Explicit permission request (PRD §10).
 * Throws with user-friendly message when unavailable — callers show
 * "Monitoring health data unavailable" but keep the rest of the app working.
 */
export async function requestHealthPermissions(): Promise<{
  granted: string[];
  allGranted: boolean;
}> {
  const plugin = await getPlugin();
  if (!plugin) throw new Error("Monitoring health data unavailable");
  return plugin.requestHealthPermissions();
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
 * On native uses ReliviaHealthPlugin; on web falls back to the
 * Notification API (permission permitting) — body text identical (PRD §21–22).
 */
export async function notifyAgent(opts: { type: string; sessionId: string }): Promise<boolean> {
  const plugin = await getPlugin();
  if (plugin) {
    try {
      await plugin.notifyAgent(opts);
      return true;
    } catch {
      return false;
    }
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

export async function openHealthSettings(): Promise<void> {
  const plugin = await getPlugin();
  if (!plugin) return;
  try {
    await plugin.openHealthSettings();
  } catch {
    /* ignore */
  }
}

/** Backend base URL for the native worker (no trailing slash). */
export function backendBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}
