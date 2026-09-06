"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { flushHealthQueue } from "@/lib/healthSyncQueue";
import { ensureMonitoringChannel, isNative, notifyAgent } from "@/lib/nativeBridge";

export type PendingNotification = {
  type: "agent_question" | "insight_ready";
  sessionId: string;
  title: string;
  body: string;
  deep_link: string;
  updated_at: string;
};

type MonitorContext = {
  /** Latest undismissed notification (trigger only, PRD §21). */
  pending: PendingNotification | null;
  dismiss: () => void;
  /** Flush offline queue on demand; returns remaining count. */
  flushQueue: () => Promise<number>;
  queueRemaining: number;
  monitoringActive: boolean;
  setMonitoringActive: (v: boolean) => void;
};

const Ctx = createContext<MonitorContext>({
  pending: null,
  dismiss: () => {},
  flushQueue: async () => 0,
  queueRemaining: 0,
  monitoringActive: false,
  setMonitoringActive: () => {},
});

export const useAutoMonitor = () => useContext(Ctx);

const SEEN_KEY = "relivia_seen_notifications_v1";
const POLL_MS = 60_000;

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-30)));
  } catch {
    /* ignore */
  }
}

/**
 * AutoMonitorProvider (PRD §23–§25).
 *
 * - Polls /api/notifications/dispatch for agent sessions needing the caregiver.
 * - Native Android: fires a REAL OS notification via Capacitor
 *   LocalNotifications; the in-app banner is suppressed unless the OS
 *   notification could not be posted (permission denied) — last-resort
 *   fallback so the trigger is never silently lost.
 * - Browser: web Notification API + in-app banner fallback (unchanged).
 * - Dedup: backend (one active session) + local seen-set + stable OS
 *   notification ids (re-polls overwrite, never stack).
 * - Handles Capacitor deep link relivia://agent?session=<id> AND
 *   LocalNotifications taps → /agent?session=<id> (resume existing session).
 */
export default function AutoMonitorProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingNotification | null>(null);
  const [queueRemaining, setQueueRemaining] = useState(0);
  const [monitoringActive, setMonitoringActive] = useState(false);
  const seenRef = useRef<Set<string> | null>(null);

  const dismiss = useCallback(() => setPending(null), []);

  const flushQueue = useCallback(async () => {
    try {
      const { remaining } = await flushHealthQueue();
      setQueueRemaining(remaining);
      return remaining;
    } catch {
      return 0;
    }
  }, []);

  // Flush queue on mount + when back online (PRD §32).
  useEffect(() => {
    flushQueue();
    const onOnline = () => flushQueue();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushQueue]);

  // Poll dispatch for pending notifications (PRD §23).
  useEffect(() => {
    if (seenRef.current === null) seenRef.current = loadSeen();
    let stopped = false;

    async function poll() {
      try {
        const res = await fetch("/api/notifications/dispatch", { cache: "no-store" });
        if (!res.ok || stopped) return;
        const json = await res.json();
        const list: PendingNotification[] = json.notifications ?? [];
        const fresh = list.find((n) => !seenRef.current!.has(`${n.type}:${n.sessionId}`));
        if (fresh && !stopped) {
          seenRef.current!.add(`${fresh.type}:${fresh.sessionId}`);
          saveSeen(seenRef.current!);
          // Fire the OS-level notification (native LN or web fallback).
          // Returns false when nothing was posted (e.g. native permission
          // denied) — only then show the in-app banner as last resort.
          const posted = await notifyAgent({
            type: fresh.type,
            sessionId: fresh.sessionId,
          }).catch(() => false);
          const onNative = await isNative().catch(() => false);
          if (!onNative || !posted) {
            if (!stopped) setPending(fresh);
          }
        }
      } catch {
        /* offline / transient — next poll retries */
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  // Capacitor deep link: relivia://agent?session=<id> (PRD §25).
  // Used by worker-posted notifications (native PendingIntent path).
  useEffect(() => {
    let remove: (() => void) | undefined;
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import("@capacitor/app");
        const listener = await App.addListener("appUrlOpen", (event: { url: string }) => {
          try {
            const url = new URL(event.url);
            if (url.protocol === "relivia:" && url.host === "agent") {
              const session = url.searchParams.get("session");
              if (session) {
                dismiss();
                router.push(`/agent?session=${session}`);
              }
            }
          } catch {
            /* malformed deep link — ignore */
          }
        });
        remove = () => listener.remove();
      } catch {
        /* not native — ignore */
      }
    })();
    return () => remove?.();
  }, [router, dismiss]);

  // LocalNotifications tap (native): extra { type, sessionId } →
  // resume the EXISTING agent session, never start a new investigation.
  // Also ensures the OS channel exists while the app runs.
  useEffect(() => {
    let remove: (() => void) | undefined;
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        await ensureMonitoringChannel().catch(() => false);
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        const listener = await LocalNotifications.addListener(
          "localNotificationActionPerformed",
          (action: {
            notification: { extra?: { type?: string; sessionId?: string } | null };
          }) => {
            const extra = action.notification?.extra;
            const sessionId =
              typeof extra?.sessionId === "string" ? extra.sessionId : null;
            if (sessionId) {
              dismiss();
              router.push(`/agent?session=${sessionId}`);
            }
          }
        );
        remove = () => listener.remove();
      } catch {
        /* not native — ignore */
      }
    })();
    return () => remove?.();
  }, [router, dismiss]);

  // Monitoring-active flag persisted per device (permission onboarding state).
  useEffect(() => {
    try {
      setMonitoringActive(localStorage.getItem("relivia_monitoring_active") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const setActive = useCallback((v: boolean) => {
    setMonitoringActive(v);
    try {
      localStorage.setItem("relivia_monitoring_active", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <Ctx.Provider
      value={{ pending, dismiss, flushQueue, queueRemaining, monitoringActive, setMonitoringActive: setActive }}
    >
      {children}
      {pending && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-[380px] z-50">
          <button
            onClick={() => {
              const target = pending.deep_link;
              dismiss();
              router.push(target);
            }}
            className="w-full text-left rounded-2xl p-4 pr-10 shadow-xl bg-[#2D1B69] text-white hover:bg-[#241656] transition relative"
          >
            <div className="font-extrabold text-sm mb-1">{pending.title}</div>
            <div className="text-white/80 text-xs leading-relaxed">{pending.body}</div>
            <span
              role="button"
              aria-label="Tutup"
              onClick={(e) => {
                e.stopPropagation();
                dismiss();
              }}
              className="absolute top-2 right-3 text-white/60 hover:text-white text-lg leading-none"
            >
              ×
            </span>
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}
