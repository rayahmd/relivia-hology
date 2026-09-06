package com.relivia.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Builds the caregiver notification (PRD §21–§23).
 *
 * The notification body NEVER contains the agent question itself —
 * it is only a trigger. Extra payload carries { type, sessionId }
 * so a tap deep-links to /agent?session=<id> (PRD §25).
 */
object NotificationHelper {

    const val CHANNEL_ID = "relivia_agent"
    const val EXTRA_TYPE = "relivia.type"
    const val EXTRA_SESSION_ID = "relivia.sessionId"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Relivia Agent",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "Pemberitahuan investigasi dan insight Relivia"
            }
            val manager =
                context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    /**
     * Posts the notification. Returns true when it was actually posted,
     * false when notifications are disabled / permission missing — so the
     * JS layer gets an honest result instead of assuming success.
     */
    fun showAgentNotification(
        context: Context,
        type: String, // "agent_question" | "insight_ready"
        sessionId: String,
        notificationId: Int = type.hashCode(),
    ): Boolean {
        ensureChannel(context)

        // Fast path: notifications disabled at OS level (incl. missing
        // POST_NOTIFICATIONS grant on Android 13+) — don't even attempt.
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return false
        }

        val (title, body) = if (type == "agent_question") {
            "Relivia" to
                "Perubahan pada pola pasien terdeteksi. " +
                "Relivia membutuhkan konteks tambahan untuk melanjutkan analisis. " +
                "Tap untuk melihat."
        } else {
            "Relivia" to
                "Relivia menemukan insight baru tentang pola pasien. " +
                "Tap untuk melihat."
        }

        // Deep link: relivia://agent?session=<id> → handled by MainActivity
        // → Capacitor App plugin (appUrlOpen) → router.push("/agent?session=")
        val deepLink = Uri.parse("relivia://agent?session=$sessionId")
        val intent = Intent(Intent.ACTION_VIEW, deepLink, context, MainActivity::class.java).apply {
            putExtra(EXTRA_TYPE, type)
            putExtra(EXTRA_SESSION_ID, sessionId)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        try {
            NotificationManagerCompat.from(context).notify(notificationId, notification)
            return true
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS not granted — caller reports notified=false
            // so the UI can prompt for permission instead of staying silent.
            return false
        }
    }
}
