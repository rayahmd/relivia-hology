/**
 * offline queue for health data.
 *
 *   health connect → local queue → network? → sync : queue
 *
 * used by the web layer when POST /api/health-sync fails. the native
 * workmanager path has its own retry — this queue covers foreground
 * syncs from the browser / webview.
 */

export type QueuedHealthPayload = {
  patientId: string;
  source: string;
  data: Array<{
    dataType: string;
    value: number;
    unit: string;
    recordedAt?: string;
  }>;
  enqueuedAt: string;
};

const STORAGE_KEY = "relivia_health_queue_v1";
const MAX_QUEUE = 50;

function loadQueue(): QueuedHealthPayload[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(items: QueuedHealthPayload[]): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_QUEUE)));
  } catch {
    /* storage full / unavailable — drop silently, never crash */
  }
}

/** add a payload to the local queue (when network is unavailable). */
export function enqueueHealth(payload: QueuedHealthPayload): number {
  const q = loadQueue();
  q.push(payload);
  saveQueue(q);
  return q.length;
}

/** number of payloads waiting for network. */
export function queuedCount(): number {
  return loadQueue().length;
}

async function postPayload(payload: QueuedHealthPayload): Promise<boolean> {
  const res = await fetch("/api/health-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientId: payload.patientId,
      source: payload.source,
      data: payload.data,
    }),
  });
  return res.ok;
}

/**
 * post with offline fallback. returns { synced, queued }.
 * network errors → queued for the next flush (never throws).
 */
export async function postHealthWithQueue(payload: QueuedHealthPayload): Promise<{
  synced: boolean;
  queued: boolean;
  response?: unknown;
}> {
  try {
    const res = await fetch("/api/health-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId: payload.patientId,
        source: payload.source,
        data: payload.data,
      }),
    });
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      return { synced: true, queued: false, response: json };
    }
    // 5xx / 429 → queue for retry. 4xx → validation/auth, do not queue.
    if (res.status >= 500 || res.status === 429) {
      enqueueHealth(payload);
      return { synced: false, queued: true };
    }
    return { synced: false, queued: false };
  } catch {
    enqueueHealth(payload);
    return { synced: false, queued: true };
  }
}

/** flush all queued payloads (call on app open / online event). */
export async function flushHealthQueue(): Promise<{
  flushed: number;
  remaining: number;
}> {
  const q = loadQueue();
  if (q.length === 0) return { flushed: 0, remaining: 0 };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { flushed: 0, remaining: q.length };
  }
  const remaining: QueuedHealthPayload[] = [];
  let flushed = 0;
  for (const payload of q) {
    try {
      const ok = await postPayload(payload);
      if (ok) flushed++;
      else remaining.push(payload);
    } catch {
      remaining.push(payload);
    }
  }
  saveQueue(remaining);
  return { flushed, remaining: remaining.length };
}
