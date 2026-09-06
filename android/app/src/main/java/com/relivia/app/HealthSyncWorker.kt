package com.relivia.app

import android.content.Context
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Periodic background worker (PRD §11).
 *
 *   Health Connect → transform → POST /api/health-sync → backend
 *
 * Scheduling (from ReliviaHealthPlugin.enableBackgroundSync):
 *   PeriodicWorkRequestBuilder<HealthSyncWorker>(6, HOURS)
 *   + Constraints(REQUIRES network CONNECTED, battery not low)
 *
 * Input data keys: backend_url, patient_id, access_token.
 * - No network / Health Connect unavailable → Result.retry()
 *   (PRD §31: retry next sync cycle, never crash).
 * - HTTP 4xx (auth / validation) → Result.failure() to avoid
 *   poisoning the queue; the JS layer re-enqueues on next app open.
 */
class HealthSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val backendUrl = inputData.getString(KEY_BACKEND_URL).orEmpty()
        val patientId = inputData.getString(KEY_PATIENT_ID).orEmpty()
        val token = inputData.getString(KEY_TOKEN).orEmpty()

        if (backendUrl.isEmpty() || patientId.isEmpty() || token.isEmpty()) {
            Log.w(TAG, "Missing input data — failing without retry")
            return@withContext Result.failure()
        }

        // Health Connect availability gate (PRD §31)
        if (HealthConnectClient.getSdkStatus(applicationContext) !=
            HealthConnectClient.SDK_AVAILABLE
        ) {
            Log.i(TAG, "Health Connect unavailable — retry next cycle")
            return@withContext Result.retry()
        }

        try {
            val granted =
                HealthConnectReader.grantedPermissions(applicationContext)
            if (!granted.containsAll(HealthConnectReader.READ_PERMISSIONS)) {
                Log.i(TAG, "Permissions not granted — retry next cycle")
                return@withContext Result.retry()
            }

            val points = HealthConnectReader.readDaily(applicationContext, daysBack = 1)
            if (points.isEmpty()) {
                Log.i(TAG, "No new health data — nothing to sync")
                return@withContext Result.success()
            }

            val payload = JSONObject()
                .put("patientId", patientId)
                .put("source", "health_connect")
                .put(
                    "data",
                    JSONArray().apply {
                        for (p in points) {
                            put(
                                JSONObject()
                                    .put("dataType", p.dataType)
                                    .put("value", p.value)
                                    .put("unit", p.unit)
                                    .put("recordedAt", p.recordedAt)
                            )
                        }
                    },
                )

            val responseBody = postJson("$backendUrl/api/health-sync", token, payload)
            Log.i(TAG, "Synced ${points.size} records")
            // Background path has no WebView: deliver the agent trigger as a
            // real system notification straight from the worker (PRD §21).
            postAgentNotificationIfPresent(responseBody)
            Result.success()
        } catch (e: NonRetryableException) {
            Log.w(TAG, "Non-retryable error: ${e.message}")
            Result.failure()
        } catch (e: Exception) {
            Log.w(TAG, "Sync failed, will retry: ${e.message}")
            Result.retry()
        }
    }

    private fun postJson(url: String, token: String, body: JSONObject): String {
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 20_000
                readTimeout = 20_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
            }
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            if (code in 500..599) throw RuntimeException("Server error $code")
            if (code == 429) throw RuntimeException("Rate limited $code")
            if (code !in 200..299) throw NonRetryableException("HTTP $code")
            return try {
                conn.inputStream.bufferedReader().use { it.readText() }
            } catch (_: Exception) {
                "{}"
            }
        } finally {
            conn?.disconnect()
        }
    }

    /** Posts the system notification when the backend created an agent trigger. */
    private fun postAgentNotificationIfPresent(responseBody: String) {
        try {
            val notification = JSONObject(responseBody).optJSONObject("notification")
                ?: return
            val type = notification.optString("type").ifEmpty { return }
            val sessionId = notification.optString("sessionId").ifEmpty { return }
            val posted = NotificationHelper.showAgentNotification(
                applicationContext, type, sessionId
            )
            Log.i(TAG, "Agent notification posted=$posted type=$type")
        } catch (e: Exception) {
            Log.w(TAG, "Could not parse/notify: ${e.message}")
        }
    }

    /** Thrown for auth/validation errors — surfaced as Result.failure(). */
    class NonRetryableException(msg: String) : RuntimeException(msg)

    companion object {
        const val TAG = "ReliviaSync"
        const val WORK_NAME = "relivia_health_sync"
        const val KEY_BACKEND_URL = "backend_url"
        const val KEY_PATIENT_ID = "patient_id"
        const val KEY_TOKEN = "access_token"
    }
}
