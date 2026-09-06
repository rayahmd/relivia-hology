package com.relivia.app

import android.content.Context
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
    fun availability(context: Context): Int =
        HealthConnectClient.getSdkStatus(context)

    suspend fun grantedPermissions(context: Context): Set<String> =
        withContext(Dispatchers.IO) {
            val client = HealthConnectClient.getOrCreate(context)
            client.permissionController.getGrantedPermissions()
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
        val client = HealthConnectClient.getOrCreate(context)
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val points = mutableListOf<HealthPoint>()

        for (i in 0..daysBack) {
            val date = today.minusDays(i.toLong())
            val start = date.atStartOfDay(zone).toInstant()
            val end = date.plusDays(1).atStartOfDay(zone).toInstant()
            val dateStr = date.toString()

            // ── Sleep (sum of session durations, hours) ──
            val sessions = client.readRecords(
                ReadRecordsRequest(
                    SleepSessionRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(start, end),
                )
            ).records
            val sleepHours = sessions.sumOf {
                ChronoUnit.SECONDS.between(it.startTime, it.endTime)
            } / 3600.0
            if (sleepHours > 0) {
                points += HealthPoint(
                    "sleep_hours",
                    round2(sleepHours),
                    "hours",
                    dateStr,
                )
            }

            // ── Steps (aggregate count) ──
            val steps = client.aggregate(
                AggregateRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(start, end),
                )
            )[StepsRecord.COUNT_TOTAL] ?: 0L
            if (steps > 0) {
                points += HealthPoint("steps", steps.toDouble(), "count", dateStr)
            }

            // ── Heart rate (daily average bpm) ──
            // HeartRateRecord.samples: List<Sample>, Sample.beatsPerMinute: Long.
            val hrRecords = client.readRecords(
                ReadRecordsRequest(
                    HeartRateRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(start, end),
                )
            ).records
            val samples = hrRecords.flatMap { it.samples }
            if (samples.isNotEmpty()) {
                val totalBeats: Long = samples.sumOf { it.beatsPerMinute }
                val avg = totalBeats.toDouble() / samples.size.toDouble()
                points += HealthPoint(
                    "heart_rate",
                    round2(avg),
                    "bpm",
                    dateStr,
                )
            }
        }

        points
    }

    private fun round2(v: Double): Double = kotlin.math.round(v * 100) / 100.0
}
