/**
 * Notification copy composer (PRD §21–§23).
 *
 * The notification is a TRIGGER only — it never contains the agent question
 * or clinical detail. Tapping it deep-links to /agent?session=<id> (PRD §25).
 */

export type NotificationType = "agent_question" | "insight_ready";

/** Android notification channel shared by the JS and worker paths. */
export const NOTIFICATION_CHANNEL_ID = "relivia-monitoring";
export const NOTIFICATION_CHANNEL_NAME = "Relivia Monitoring";
export const NOTIFICATION_SOUND = "relivia_beep.wav";

/**
 * Stable numeric notification id per (type, session): re-polls overwrite
 * the same shade entry instead of stacking duplicates, while the question
 * and the insight of one session stay visible as two entries.
 */
export function stableNotificationId(type: NotificationType, sessionId: string): number {
  const key = `${type}:${sessionId}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 1000000 + 1000;
}

export function agentNotificationCopy(type: NotificationType): {
  title: string;
  body: string;
} {
  if (type === "agent_question") {
    return {
      title: "Relivia",
      body:
        "Perubahan pada pola pasien terdeteksi. " +
        "Relivia membutuhkan konteks tambahan untuk melanjutkan analisis. " +
        "Tap untuk melihat.",
    };
  }
  return {
    title: "Relivia",
    body:
      "Relivia menemukan insight baru tentang pola pasien. " +
      "Tap untuk melihat.",
  };
}

/** Deep-link target for a notification tap (PRD §25). */
export function agentDeepLink(sessionId: string): string {
  return `/agent?session=${sessionId}`;
}

/** Native deep-link URI handled by MainActivity → Capacitor App plugin. */
export function agentDeepLinkUri(sessionId: string): string {
  return `relivia://agent?session=${sessionId}`;
}
