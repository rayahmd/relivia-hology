/**
 * notification copy composer.
 *
 * the notification is a trigger only — it never contains the agent question
 * or clinical detail. tapping it deep-links to /agent?session=<id>.
 */

export type NotificationType = "agent_question" | "insight_ready";

/** android notification channel shared by the js and worker paths. */
export const NOTIFICATION_CHANNEL_ID = "relivia-monitoring";
export const NOTIFICATION_CHANNEL_NAME = "Relivia Monitoring";
export const NOTIFICATION_SOUND = "relivia_beep.wav";

/**
 * stable numeric notification id per (type, session): re-polls overwrite
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

/** deep-link target for a notification tap. */
export function agentDeepLink(sessionId: string): string {
  return `/agent?session=${sessionId}`;
}

/** native deep-link uri handled by mainactivity → capacitor app plugin. */
export function agentDeepLinkUri(sessionId: string): string {
  return `relivia://agent?session=${sessionId}`;
}
