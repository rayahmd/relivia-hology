package com.relivia.app

import android.content.Context
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Reads sleep / steps / heart-rate from Android Health Connect (PRD §9).
 *
 * Returns data in the same shape as POST /api/health-sync:
 *   [{ dataType, value, unit, recordedAt }]
 *
 * All functions are safe to call from a background thread / CoroutineWorker.
 * Any failure throws — callers (plugin / worker) translate that into
 * "retry next sync cycle" per PRD §31, never a crash.
 */
object HealthConnectReader {

    const val DEBUG_TAG = "ReliviaHealthDebug"
    private const val BG_PERMISSION = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"

    // connect-client 1.1.0: getReadPermission takes a Kotlin KClass.
    val READ_PERMISSIONS = setOf(
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
    )

    data class HealthPoint(
        val dataType: String,
        val value: Double,
        val unit: String,
        val recordedAt: String, // yyyy-MM-dd
    )

    /** 0 = SDK unavailable on this device. */
    fun availability(context: Context): Int {
        val status = HealthConnectClient.getSdkStatus(context)
        Log.d(DEBUG_TAG, "availability: sdkStatus=$status (${sdkStatusName(status)}) available=${status == HealthConnectClient.SDK_AVAILABLE}")
        try {
            HealthConnectClient.getOrCreate(context)
            Log.d(DEBUG_TAG, "availability: HealthConnectClient.getOrCreate succeeded")
        } catch (e: Exception) {
            Log.e(DEBUG_TAG, "availability: HealthConnectClient.getOrCreate FAILED class=${e.javaClass.name} msg=${e.message}", e)
        }
        return status
    }

    private fun sdkStatusName(status: Int): String = when (status) {
        HealthConnectClient.SDK_AVAILABLE -> "SDK_AVAILABLE"
        HealthConnectClient.SDK_UNAVAILABLE -> "SDK_UNAVAILABLE"
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED"
        else -> "UNKNOWN($status)"
    }

    suspend fun grantedPermissions(context: Context): Set<String> =
        withContext(Dispatchers.IO) {
            try {
                val client = HealthConnectClient.getOrCreate(context)
                Log.d(DEBUG_TAG, "grantedPermissions: HealthConnectClient created successfully")
                val granted = client.permissionController.getGrantedPermissions()
                logGrantedSet(granted)
                granted
            } catch (e: Exception) {
                logHcException("grantedPermissions", e)
                throw e
            }
        }

    private fun logGrantedSet(granted: Set<String>) {
        // Granted strings only — no patient data.
        Log.d(DEBUG_TAG, "permissions: grantedFullSet=$granted")
        val stepsPerm = HealthPermission.getReadPermission(StepsRecord::class)
        val sleepPerm = HealthPermission.getReadPermission(SleepSessionRecord::class)
        val hrPerm = HealthPermission.getReadPermission(HeartRateRecord::class)
        Log.d(DEBUG_TAG, "permissions: READ_STEPS[$stepsPerm] granted=${granted.contains(stepsPerm)}")
        Log.d(DEBUG_TAG, "permissions: READ_SLEEP[$sleepPerm] granted=${granted.contains(sleepPerm)}")
        Log.d(DEBUG_TAG, "permissions: READ_HEART_RATE[$hrPerm] granted=${granted.contains(hrPerm)}")
        Log.d(DEBUG_TAG, "permissions: BACKGROUND[$BG_PERMISSION] granted=${granted.contains(BG_PERMISSION)}")
        Log.d(DEBUG_TAG, "permissions: allRequestedGranted=${granted.containsAll(READ_PERMISSIONS)}")
    }

    private fun logHcException(where: String, e: Throwable) {
        val kind = when (e) {
            is SecurityException -> "SecurityException/permission-issue"
            is IllegalArgumentException -> "IllegalArgumentException/invalid-query"
            is IllegalStateException -> "IllegalStateException/health-connect-unavailable?"
            is UnsupportedOperationException -> "UnsupportedOperationException/health-connect-unavailable"
            else -> "other-runtime"
        }
        Log.e(DEBUG_TAG, "$where: FAILED kind=$kind class=${e.javaClass.name} msg=${e.message}", e)
    }

    /**
     * Reads the last [daysBack] days (inclusive of today).
     * Sleep = total hours per day, Steps = total count per day,
     * Heart rate = daily average bpm.
     */
    suspend fun readDaily(
        context: Context,
        daysBack: Int = 1,
    ): List<HealthPoint> = withContext(Dispatchers.IO) {
        val client: HealthConnectClient
        try {
            client = HealthConnectClient.getOrCreate(context)
            Log.d(DEBUG_TAG, "readDaily: HealthConnectClient created successfully")
        } catch (e: Exception) {
            logHcException("readDaily.getOrCreate", e)
            throw e
        }
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val startDate = today.minusDays(daysBack.toLong())
        Log.d(DEBUG_TAG, "readDaily: zone=$zone today=$today daysBack=$daysBack")
        Log.d(DEBUG_TAG, "sync.start: range=$startDate..$today expectedDates=${daysBack + 1}")
        val points = mutableListOf<HealthPoint>()

        for (i in 0..daysBack) {
            val date = today.minusDays(i.toLong())
            val start = date.atStartOfDay(zone).toInstant()
            val end = date.plusDays(1).atStartOfDay(zone).toInstant()
            val dateStr = date.toString()
            Log.d(DEBUG_TAG, "sync.date.query: date=$dateStr start=$start end=$end")

            // ── Sleep (sum of session durations, hours) ──
            val sessions = try {
                client.readRecords(
                    ReadRecordsRequest(
                        SleepSessionRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(start, end),
                    )
                ).records
            } catch (e: Exception) {
                logHcException("readDaily.sleep date=$dateStr", e)
                throw e
            }
            val sleepHours = sessions.sumOf {
                ChronoUnit.SECONDS.between(it.startTime, it.endTime)
            } / 3600.0
            if (sessions.isEmpty()) {
                Log.d(DEBUG_TAG, "sleep.result: date=$dateStr no records returned (empty-result, nothing emitted)")
            } else {
                Log.d(DEBUG_TAG, "sleep.result: date=$dateStr sessions=${sessions.size} hours=$sleepHours emitted=${sleepHours > 0}")
            }
            if (sleepHours > 0) {
                points += HealthPoint(
                    "sleep_hours",
                    round2(sleepHours),
                    "hours",
                    dateStr,
                )
            }

            // ── Steps (aggregate count — PRODUCTION path, unchanged) ──
            Log.d(DEBUG_TAG, "steps.query: date=$dateStr zone=$zone start=$start end=$end metric=StepsRecord.COUNT_TOTAL")
            val aggResponse = try {
                client.aggregate(
                    AggregateRequest(
                        metrics = setOf(StepsRecord.COUNT_TOTAL),
                        timeRangeFilter = TimeRangeFilter.between(start, end),
                    )
                )
            } catch (e: Exception) {
                logHcException("readDaily.steps.aggregate date=$dateStr", e)
                throw e
            }
            Log.d(DEBUG_TAG, "steps.result: date=$dateStr rawResponse=$aggResponse")
            val steps = aggResponse[StepsRecord.COUNT_TOTAL] ?: 0L
            Log.d(DEBUG_TAG, "steps.result: date=$dateStr COUNT_TOTAL=$steps interpretedSteps=$steps nonZero=${steps > 0}")
            if (steps == 0L) {
                Log.d(DEBUG_TAG, "steps.result: date=$dateStr zero-steps (valid 0 aggregate — nothing emitted, API/schema unchanged)")
            }
            // DEBUG-ONLY diagnostic: does HC contain StepsRecords at all, and from which origins?
            // Production total stays aggregate() above; this never feeds points.
            try {
                val diag = client.readRecords(
                    ReadRecordsRequest(
                        StepsRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(start, end),
                    )
                ).records
                val byOrigin = diag.groupBy { it.metadata.dataOrigin.packageName }
                    .mapValues { (_, recs) -> recs.size to recs.sumOf { it.count } }
                Log.d(DEBUG_TAG, "steps.debugOnly.readRecords: date=$dateStr recordCount=${diag.size} origins=$byOrigin")
                if (diag.isNotEmpty() && steps == 0L) {
                    Log.w(DEBUG_TAG, "steps.debugOnly.DISCREPANCY: date=$dateStr sourceRecordsExist=${diag.size} but aggregate COUNT_TOTAL=0")
                }
                if (diag.isEmpty()) {
                    Log.d(DEBUG_TAG, "steps.debugOnly.EMPTY: date=$dateStr no StepsRecord rows in Health Connect for range (empty-result)")
                }
            } catch (e: Exception) {
                logHcException("readDaily.steps.debugOnly.readRecords date=$dateStr", e)
                // Diagnostic-only: never fail production read on debug path.
            }
            if (steps > 0) {
                points += HealthPoint("steps", steps.toDouble(), "count", dateStr)
            }

            // ── Heart rate (daily average bpm) ──
            // HeartRateRecord.samples: List<Sample>, Sample.beatsPerMinute: Long.
            val hrRecords = try {
                client.readRecords(
                    ReadRecordsRequest(
                        HeartRateRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(start, end),
                    )
                ).records
            } catch (e: Exception) {
                logHcException("readDaily.heartRate date=$dateStr", e)
                throw e
            }
            val samples = hrRecords.flatMap { it.samples }
            if (hrRecords.isEmpty()) {
                Log.d(DEBUG_TAG, "heartRate.result: date=$dateStr no records returned (empty-result, nothing emitted)")
            } else if (samples.isEmpty()) {
                Log.d(DEBUG_TAG, "heartRate.result: date=$dateStr records=${hrRecords.size} samples=0 (valid 0-sample aggregate, nothing emitted)")
            } else {
                val totalBeats: Long = samples.sumOf { it.beatsPerMinute }
                val avg = totalBeats.toDouble() / samples.size.toDouble()
                Log.d(DEBUG_TAG, "heartRate.result: date=$dateStr records=${hrRecords.size} samples=${samples.size} avgBpm=$avg emitted=true")
                points += HealthPoint(
                    "heart_rate",
                    round2(avg),
                    "bpm",
                    dateStr,
                )
            }
        }

        Log.d(DEBUG_TAG, "readDaily: done points=${points.size} types=${points.map { it.dataType }}")
        Log.d(DEBUG_TAG, "sync.total: healthPoints=${points.size}")
        points
    }

    private fun round2(v: Double): Double = kotlin.math.round(v * 100) / 100.0
}
