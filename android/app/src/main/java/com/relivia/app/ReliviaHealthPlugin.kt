package com.relivia.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.time.Duration
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject

/**
 * Capacitor bridge for the Next.js layer (PRD §7–§8).
 *
 * JS usage (see lib/nativeBridge.ts):
 *   ReliviaHealth.isAvailable()
 *   ReliviaHealth.requestHealthPermissions()
 *   ReliviaHealth.readHealth({ daysBack })
 *   ReliviaHealth.enableBackgroundSync({ backendUrl, patientId, token })
 *   ReliviaHealth.notifyAgent({ type, sessionId })
 *
 * Native responsibilities end here: Health Connect, background worker,
 * notification, permissions, deep link. All UI stays in Next.js (PRD §33).
 */
@CapacitorPlugin(
    name = "ReliviaHealth",
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = ReliviaHealthPlugin.NOTIFICATION_ALIAS),
    ],
)
class ReliviaHealthPlugin : Plugin() {

    companion object {
        const val NOTIFICATION_ALIAS = "notifications"
    }

    /** Guards against concurrent permission launches (no stacked screens). */
    @Volatile
    private var healthPermissionInFlight = false

    /**
     * App version for the web layer: versionName + versionCode read from the
     * installed package (never hardcoded). The web layer compares this
     * against its own WEB_BUILD marker to detect a stale APK or stale web.
     */
    @PluginMethod
    fun getAppVersion(call: PluginCall) {
        val ret = JSObject()
        try {
            val pm = context.packageManager
            val info = pm.getPackageInfo(context.packageName, 0)
            ret.put("version", info.versionName ?: "unknown")
            try {
                ret.put(
                    "versionCode",
                    androidx.core.content.pm.PackageInfoCompat.getLongVersionCode(info),
                )
            } catch (_: Exception) {
                ret.put("versionCode", -1)
            }
        } catch (_: PackageManager.NameNotFoundException) {
            ret.put("version", "unknown")
            ret.put("versionCode", -1)
        }
        call.resolve(ret)
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val status = HealthConnectClient.getSdkStatus(context)
        val ret = JSObject()
        ret.put("available", status == HealthConnectClient.SDK_AVAILABLE)
        ret.put("sdkStatus", status)
        call.resolve(ret)
    }

    /**
     * Opens the Health Connect permission screen. Named requestHealthPermissions
     * (not requestPermissions) to avoid hiding Plugin.requestPermissions(PluginCall).
     *
     * Lifecycle-safe flow: the Intent is built from Health Connect's
     * ActivityResultContract but launched through Capacitor's managed
     * launcher (startActivityForResult + @ActivityCallback), which owns the
     * ActivityResultLauncher lifecycle. The result callback always re-queries
     * the granted set — no manual ActivityResult parsing, no stored contract.
     *
     * Distinct rejection codes so the UI can guide the caregiver:
     * - HEALTH_CONNECT_UNAVAILABLE (not installed / unsupported device)
     * - HEALTH_CONNECT_UPDATE_REQUIRED (provider needs Play Store update)
     * - PERMISSION_IN_PROGRESS (a request is already showing)
     * - PERMISSION_LAUNCH_FAILED (permission screen could not be opened;
     *   use openHealthSettings as manual fallback)
     */
    @PluginMethod
    fun requestHealthPermissions(call: PluginCall) {
        val activity = activity ?: run {
            call.reject("Activity unavailable")
            return
        }
        when (HealthConnectClient.getSdkStatus(context)) {
            HealthConnectClient.SDK_AVAILABLE -> Unit // proceed
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                call.reject(
                    "HEALTH_CONNECT_UPDATE_REQUIRED",
                    "Health Connect needs an update from the Play Store",
                )
                return
            }
            else -> {
                call.reject(
                    "HEALTH_CONNECT_UNAVAILABLE",
                    "Health Connect is not available on this device",
                )
                return
            }
        }
        if (healthPermissionInFlight) {
            call.reject(
                "PERMISSION_IN_PROGRESS",
                "A Health Connect permission request is already showing",
            )
            return
        }
        healthPermissionInFlight = true
        // Fast path on a background thread: already granted earlier (e.g. via
        // Health Connect settings) — resolve immediately, no screen launch.
        Thread {
            try {
                val already = runBlocking {
                    HealthConnectReader.grantedPermissions(context)
                }
                if (already.containsAll(HealthConnectReader.READ_PERMISSIONS)) {
                    healthPermissionInFlight = false
                    val ret = JSObject()
                    ret.put("granted", JSONArray(already.toList()))
                    ret.put("allGranted", true)
                    call.resolve(ret)
                    return@Thread
                }
            } catch (_: Exception) {
                // Fall through to the permission screen.
            }
            activity.runOnUiThread {
                try {
                    val requestContract =
                        PermissionController.createRequestPermissionResultContract()
                    val intent = requestContract.createIntent(
                        activity,
                        HealthConnectReader.READ_PERMISSIONS,
                    )
                    startActivityForResult(call, intent, "onHealthPermissionResult")
                } catch (e: Exception) {
                    healthPermissionInFlight = false
                    call.reject(
                        "PERMISSION_LAUNCH_FAILED",
                        "Could not open the Health Connect permission screen: ${e.message}",
                        e,
                    )
                }
            }
        }.start()
    }

    @ActivityCallback
    private fun onHealthPermissionResult(call: PluginCall?, result: ActivityResult) {
        healthPermissionInFlight = false
        if (call == null) return
        // Back-press / dismissal included: always settle by re-querying the
        // current granted set (never hang, never manual-parse the result).
        Thread {
            try {
                val granted = runBlocking {
                    HealthConnectReader.grantedPermissions(context)
                }
                val ret = JSObject()
                ret.put("granted", JSONArray(granted.toList()))
                ret.put(
                    "allGranted",
                    granted.containsAll(HealthConnectReader.READ_PERMISSIONS),
                )
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("PERMISSION_FAILED", e.message, e)
            }
        }.start()
    }

    @PluginMethod
    fun readHealth(call: PluginCall) {
        val daysBack = call.getInt("daysBack", 1) ?: 1
        Thread {
            try {
                val points = runBlocking {
                    HealthConnectReader.readDaily(context, daysBack.coerceIn(1, 7))
                }
                val ret = JSObject()
                val arr = JSONArray()
                for (p in points) {
                    arr.put(
                        JSONObject()
                            .put("dataType", p.dataType)
                            .put("value", p.value)
                            .put("unit", p.unit)
                            .put("recordedAt", p.recordedAt)
                    )
                }
                ret.put("data", arr)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("READ_FAILED", e.message, e)
            }
        }.start()
    }

    /**
     * Schedules the periodic WorkManager sync (every 6h, requires network).
     * Credentials are passed as Worker input (never persisted elsewhere,
     * PRD §35 — no Health Connect credential is stored).
     */
    @PluginMethod
    fun enableBackgroundSync(call: PluginCall) {
        val backendUrl = call.getString("backendUrl")
        val patientId = call.getString("patientId")
        val token = call.getString("token")
        if (backendUrl.isNullOrEmpty() || patientId.isNullOrEmpty() || token.isNullOrEmpty()) {
            call.reject("INVALID_ARGS", "backendUrl, patientId, token required")
            return
        }
        val request = PeriodicWorkRequestBuilder<HealthSyncWorker>(
            repeatInterval = Duration.ofHours(6),
        )
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .setRequiresBatteryNotLow(true)
                    .build()
            )
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                Duration.ofMinutes(15),
            )
            .setInputData(
                workDataOf(
                    HealthSyncWorker.KEY_BACKEND_URL to backendUrl,
                    HealthSyncWorker.KEY_PATIENT_ID to patientId,
                    HealthSyncWorker.KEY_TOKEN to token,
                )
            )
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            HealthSyncWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
        val ret = JSObject()
        ret.put("scheduled", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun disableBackgroundSync(call: PluginCall) {
        WorkManager.getInstance(context)
            .cancelUniqueWork(HealthSyncWorker.WORK_NAME)
        val ret = JSObject()
        ret.put("scheduled", false)
        call.resolve(ret)
    }

    /** Current POST_NOTIFICATIONS state (always granted below Android 13). */
    @PluginMethod
    fun checkNotificationPermission(call: PluginCall) {
        val ret = JSObject()
        ret.put("granted", isNotificationGranted())
        call.resolve(ret)
    }

    /**
     * Requests POST_NOTIFICATIONS at runtime (Android 13+). This was the
     * missing step that caused notifications to appear only as an in-app
     * banner: without the runtime grant, NotificationManager.notify()
     * throws SecurityException and the system notification never posts.
     */
    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (isNotificationGranted()) {
            val ret = JSObject()
            ret.put("granted", true)
            call.resolve(ret)
            return
        }
        requestPermissionForAlias(NOTIFICATION_ALIAS, call, "onNotificationPermissionResult")
    }

    @PermissionCallback
    private fun onNotificationPermissionResult(call: PluginCall) {
        val ret = JSObject()
        ret.put("granted", isNotificationGranted())
        call.resolve(ret)
    }

    private fun isNotificationGranted(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    /** Shows the agent notification immediately (used after foreground sync). */
    @PluginMethod
    fun notifyAgent(call: PluginCall) {
        val type = call.getString("type") ?: "agent_question"
        val sessionId = call.getString("sessionId") ?: run {
            call.reject("INVALID_ARGS", "sessionId required")
            return
        }
        val posted = NotificationHelper.showAgentNotification(context, type, sessionId)
        val ret = JSObject()
        ret.put("notified", posted)
        call.resolve(ret)
    }

    /**
     * Opens the Health Connect settings screen so the caregiver can manage
     * permissions manually (fallback when the inline permission flow fails).
     */
    @PluginMethod
    fun openHealthSettings(call: PluginCall) {
        try {
            val intent = Intent(
                HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS
            )
            activity?.startActivity(intent)
            val ret = JSObject()
            ret.put("opened", true)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("OPEN_FAILED", e.message, e)
        }
    }

    /**
     * Opens system Notification Settings for Relivia package so caregiver
     * can enable notifications if system runtime dialog was previously denied.
     */
    @PluginMethod
    fun openNotificationSettings(call: PluginCall) {
        try {
            val intent = Intent().apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    action = android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS
                    putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
                } else {
                    action = android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS
                    data = android.net.Uri.fromParts("package", context.packageName, null)
                }
            }
            activity?.startActivity(intent)
            val ret = JSObject()
            ret.put("opened", true)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("OPEN_FAILED", e.message, e)
        }
    }

}
