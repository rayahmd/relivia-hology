package com.relivia.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
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
        const val TAG = "ReliviaHealth"
        const val DEBUG_TAG = "ReliviaHealthDebug"
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
        Log.d(TAG, "[ReliviaHealth] getAppVersion called")
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
        Log.d(TAG, "[ReliviaHealth] getAppVersion resolving: $ret")
        call.resolve(ret)
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        Log.d(TAG, "[ReliviaHealth] isAvailable called")
        val status = HealthConnectClient.getSdkStatus(context)
        Log.d(DEBUG_TAG, "plugin.isAvailable: sdkStatus=$status available=${status == HealthConnectClient.SDK_AVAILABLE}")
        try {
            HealthConnectClient.getOrCreate(context)
            Log.d(DEBUG_TAG, "plugin.isAvailable: HealthConnectClient.getOrCreate succeeded")
        } catch (e: Exception) {
            Log.e(DEBUG_TAG, "plugin.isAvailable: getOrCreate FAILED class=${e.javaClass.name} msg=${e.message}", e)
        }
        val ret = JSObject()
        ret.put("available", status == HealthConnectClient.SDK_AVAILABLE)
        ret.put("sdkStatus", status)
        Log.d(TAG, "[ReliviaHealth] isAvailable resolving: available=${status == HealthConnectClient.SDK_AVAILABLE} sdkStatus=$status")
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
        Log.d(TAG, "[ReliviaHealth] requestHealthPermissions called")
        Log.d(DEBUG_TAG, "plugin.requestHealthPermissions.start")
        val activity = activity ?: run {
            Log.w(TAG, "[ReliviaHealth] requestHealthPermissions rejecting: Activity unavailable")
            Log.e(DEBUG_TAG, "plugin.requestHealthPermissions.end: noActivity result=reject")
            call.reject("Activity unavailable")
            return
        }
        val sdkStatus = HealthConnectClient.getSdkStatus(context)
        Log.d(DEBUG_TAG, "plugin.requestHealthPermissions: sdkStatus=$sdkStatus available=${sdkStatus == HealthConnectClient.SDK_AVAILABLE}")
        when (sdkStatus) {
            HealthConnectClient.SDK_AVAILABLE -> Unit // proceed
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                Log.w(TAG, "[ReliviaHealth] requestHealthPermissions rejecting: HEALTH_CONNECT_UPDATE_REQUIRED")
                Log.e(DEBUG_TAG, "plugin.requestHealthPermissions.end: updateRequired result=reject")
                call.reject(
                    "HEALTH_CONNECT_UPDATE_REQUIRED",
                    "Health Connect needs an update from the Play Store",
                )
                return
            }
            else -> {
                Log.w(TAG, "[ReliviaHealth] requestHealthPermissions rejecting: HEALTH_CONNECT_UNAVAILABLE")
                Log.e(DEBUG_TAG, "plugin.requestHealthPermissions.end: unavailable sdkStatus=$sdkStatus result=reject")
                call.reject(
                    "HEALTH_CONNECT_UNAVAILABLE",
                    "Health Connect is not available on this device",
                )
                return
            }
        }
        if (healthPermissionInFlight) {
            Log.w(TAG, "[ReliviaHealth] requestHealthPermissions rejecting: PERMISSION_IN_PROGRESS")
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
                    Log.d(TAG, "[ReliviaHealth] requestHealthPermissions resolving (fast path): allGranted=true")
                    Log.d(DEBUG_TAG, "plugin.requestHealthPermissions.end: fastPath allGranted=true granted=$already")
                    call.resolve(ret)
                    return@Thread
                }
                Log.d(DEBUG_TAG, "plugin.requestHealthPermissions: fastPath skipped allGranted=false, launching screen")
            } catch (e: Exception) {
                Log.e(DEBUG_TAG, "plugin.requestHealthPermissions: fastPath check FAILED class=${e.javaClass.name} msg=${e.message}, falling through to screen", e)
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
                    Log.d(TAG, "[ReliviaHealth] requestHealthPermissions launching permission screen")
                    Log.d(DEBUG_TAG, "plugin.requestHealthPermissions: launching permission screen")
                    startActivityForResult(call, intent, "onHealthPermissionResult")
                } catch (e: Exception) {
                    healthPermissionInFlight = false
                    Log.w(TAG, "[ReliviaHealth] requestHealthPermissions rejecting: PERMISSION_LAUNCH_FAILED: ${e.message}")
                    Log.e(DEBUG_TAG, "plugin.requestHealthPermissions.end: launchFailed class=${e.javaClass.name} msg=${e.message}", e)
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
        Log.d(TAG, "[ReliviaHealth] onHealthPermissionResult: resultCode=${result.resultCode} hasCall=${call != null}")
        Log.d(DEBUG_TAG, "plugin.onHealthPermissionResult: resultCode=${result.resultCode} hasCall=${call != null}")
        if (call == null) return
        // Back-press / dismissal included: always settle by re-querying the
        // current granted set (never hang, never manual-parse the result).
        Thread {
            try {
                val granted = runBlocking {
                    HealthConnectReader.grantedPermissions(context)
                }
                val all = granted.containsAll(HealthConnectReader.READ_PERMISSIONS)
                val ret = JSObject()
                ret.put("granted", JSONArray(granted.toList()))
                ret.put(
                    "allGranted",
                    all,
                )
                Log.d(TAG, "[ReliviaHealth] onHealthPermissionResult resolving: allGranted=${granted.containsAll(HealthConnectReader.READ_PERMISSIONS)}")
                Log.d(DEBUG_TAG, "plugin.onHealthPermissionResult.end: allGranted=$all granted=$granted")
                call.resolve(ret)
            } catch (e: Exception) {
                Log.w(TAG, "[ReliviaHealth] onHealthPermissionResult rejecting: PERMISSION_FAILED: ${e.message}")
                Log.e(DEBUG_TAG, "plugin.onHealthPermissionResult.end: FAILED class=${e.javaClass.name} msg=${e.message}", e)
                call.reject("PERMISSION_FAILED", e.message, e)
            }
        }.start()
    }

    @PluginMethod
    fun readHealth(call: PluginCall) {
        val daysBack = call.getInt("daysBack", 1) ?: 1
        Log.d(DEBUG_TAG, "plugin.readHealth.start: daysBack=$daysBack")
        Thread {
            try {
                val points = runBlocking {
                    HealthConnectReader.readDaily(context, daysBack.coerceIn(1, 7))
                }
                Log.d(DEBUG_TAG, "plugin.readHealth.end: returned=${points.size}")
                for (p in points) {
                    // Non-sensitive metrics only (type/unit/date/value, no identifiers).
                    Log.d(DEBUG_TAG, "plugin.readHealth.item: dataType=${p.dataType} value=${p.value} unit=${p.unit} date=${p.recordedAt}")
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
                val kind = when (e) {
                    is SecurityException -> "SecurityException/permission-issue"
                    is IllegalArgumentException -> "IllegalArgumentException/invalid-query"
                    is IllegalStateException -> "IllegalStateException/unavailable?"
                    else -> "other-runtime"
                }
                Log.e(DEBUG_TAG, "plugin.readHealth.end: FAILED kind=$kind class=${e.javaClass.name} msg=${e.message}", e)
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
        val input = workDataOf(
            HealthSyncWorker.KEY_BACKEND_URL to backendUrl,
            HealthSyncWorker.KEY_PATIENT_ID to patientId,
            HealthSyncWorker.KEY_TOKEN to token,
        )
        val request = PeriodicWorkRequestBuilder<HealthSyncWorker>(
            repeatInterval = Duration.ofHours(6),
        )
            .setConstraints(syncConstraints())
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                Duration.ofMinutes(15),
            )
            .setInputData(input)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            HealthSyncWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
        // Immediate one-shot 7-day import so the first sync doesn't wait
        // for the 6-hour cycle. Same worker / payload as the periodic path.
        WorkManager.getInstance(context).enqueue(
            OneTimeWorkRequestBuilder<HealthSyncWorker>()
                .setConstraints(syncConstraints())
                .setInputData(input)
                .build()
        )
        Log.d(DEBUG_TAG, "plugin.enableBackgroundSync: periodic scheduled + one-time immediate enqueued")
        val ret = JSObject()
        ret.put("scheduled", true)
        call.resolve(ret)
    }

    /**
     * Manual one-shot sync (last 7 calendar days via HealthSyncWorker).
     * Same worker / payload as enableBackgroundSync; callable without
     * waiting for the 6-hour cycle.
     */
    @PluginMethod
    fun syncNow(call: PluginCall) {
        val backendUrl = call.getString("backendUrl")
        val patientId = call.getString("patientId")
        val token = call.getString("token")
        if (backendUrl.isNullOrEmpty() || patientId.isNullOrEmpty() || token.isNullOrEmpty()) {
            call.reject("INVALID_ARGS", "backendUrl, patientId, token required")
            return
        }
        Log.d(DEBUG_TAG, "plugin.syncNow.start: enqueuing one-time 7-day import")
        val immediate = OneTimeWorkRequestBuilder<HealthSyncWorker>()
            .setConstraints(syncConstraints())
            .setInputData(
                workDataOf(
                    HealthSyncWorker.KEY_BACKEND_URL to backendUrl,
                    HealthSyncWorker.KEY_PATIENT_ID to patientId,
                    HealthSyncWorker.KEY_TOKEN to token,
                )
            )
            .build()
        WorkManager.getInstance(context).enqueue(immediate)
        Log.d(DEBUG_TAG, "plugin.syncNow.end: enqueued workId=${immediate.id}")
        val ret = JSObject()
        ret.put("enqueued", true)
        call.resolve(ret)
    }

    private fun syncConstraints(): Constraints =
        Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build()

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
        Log.d(TAG, "[ReliviaHealth] checkNotificationPermission called")
        val ret = JSObject()
        ret.put("granted", isNotificationGranted())
        Log.d(TAG, "[ReliviaHealth] checkNotificationPermission resolving: granted=${isNotificationGranted()}")
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
        Log.d(TAG, "[ReliviaHealth] requestNotificationPermission called")
        if (isNotificationGranted()) {
            val ret = JSObject()
            ret.put("granted", true)
            Log.d(TAG, "[ReliviaHealth] requestNotificationPermission resolving: already granted")
            call.resolve(ret)
            return
        }
        Log.d(TAG, "[ReliviaHealth] requestNotificationPermission launching OS dialog")
        requestPermissionForAlias(NOTIFICATION_ALIAS, call, "onNotificationPermissionResult")
    }

    @PermissionCallback
    private fun onNotificationPermissionResult(call: PluginCall) {
        val granted = isNotificationGranted()
        Log.d(TAG, "[ReliviaHealth] onNotificationPermissionResult resolving: granted=$granted")
        val ret = JSObject()
        ret.put("granted", granted)
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
