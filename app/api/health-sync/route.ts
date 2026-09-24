import { NextRequest, NextResponse } from "next/server";
import { resolveApiAuth } from "@/lib/supabase/bearer";
import { recalcBaselines } from "@/lib/recalcBaseline";
import { runAutomaticPipeline } from "@/lib/autoTrigger";

const ALLOWED_TYPES = new Set(["sleep_hours", "steps", "heart_rate"]);
const ALLOWED_SOURCES = new Set([
  "health_connect",
  "health_connect_simulation",
  "manual",
  "simulation",
  "demo_seed",
]);

/**
 * POST /api/health-sync (PRD §11–§15).
 *
 * Accepts BOTH the PRD contract (camelCase):
 *   { patientId, source: "health_connect", data: [{ dataType, value, unit, recordedAt }] }
 * and the legacy web contract (snake_case):
 *   { patient_id, data: [{ data_type, value, unit, recorded_at }] }
 *
 * Pipeline per sync:
 *   store → recalc personal baseline → change detection →
 *   automatic agent trigger → { notification: { type, sessionId } | null }
 *
 * Auth: session cookie (browser/WebView) OR Authorization: Bearer token
 * (native WorkManager background sync, PRD §11).
 */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await resolveApiAuth(req);
    if (!user || !supabase) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    // ── Dual-format normalization (PRD §12 + backward compat) ──
    const patientId: string | undefined = body.patientId ?? body.patient_id;
    const source: string = body.source ?? "manual";
    const rawData = body.data;

    if (!patientId || !Array.isArray(rawData) || rawData.length === 0) {
      return NextResponse.json(
        { error: "patientId and data[] required" },
        { status: 400 }
      );
    }
    if (!ALLOWED_SOURCES.has(source)) {
      return NextResponse.json(
        { error: `Unknown source "${source}"` },
        { status: 400 }
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const records: Array<{
      patient_id: string;
      data_type: string;
      value: number;
      unit: string;
      recorded_at: string;
      source: string;
    }> = [];

    for (const d of rawData) {
      const dataType: string | undefined = d.dataType ?? d.data_type;
      const value = Number(d.value);
      if (!dataType || !ALLOWED_TYPES.has(dataType) || !Number.isFinite(value)) {
        return NextResponse.json(
          { error: `Invalid record: dataType must be one of sleep_hours|steps|heart_rate with numeric value` },
          { status: 400 }
        );
      }
      records.push({
        patient_id: patientId,
        data_type: dataType,
        value,
        unit: typeof d.unit === "string" ? d.unit : "",
        recorded_at: typeof (d.recordedAt ?? d.recorded_at) === "string"
          ? (d.recordedAt ?? d.recorded_at)
          : today,
        source,
      });
    }

    // ── Verify ownership (PRD §35) ──
    const { data: patient } = await supabase
      .from("patients")
      .select("id, name")
      .eq("id", patientId)
      .eq("caregiver_id", user.id)
      .single();
    if (!patient) return NextResponse.json({ error: "Patient not found" }, { status: 404 });

    const { error } = await supabase
      .from("health_data")
      .upsert(records, { onConflict: "patient_id,data_type,recorded_at" });
    if (error) throw error;

    // ── Personal baseline refresh + automatic pipeline (PRD §13–§17) ──
    let baselineMap: Record<string, number> = {};
    try {
      baselineMap = await recalcBaselines(supabase, patientId);
    } catch (e) {
      console.error("[health-sync] baseline recalc failed", e);
    }

    let pipeline = null;
    try {
      pipeline = await runAutomaticPipeline(supabase, patient, baselineMap);
    } catch (e) {
      console.error("[health-sync] auto pipeline failed", e);
      // Storage already succeeded — report sync ok with pipeline error
      // (PRD §31: health sync must not crash the app).
      return NextResponse.json({
        ok: true,
        synced: records.length,
        pipelineError: String(e),
      });
    }

    return NextResponse.json({
      ok: true,
      synced: records.length,
      detected: pipeline.detected,
      changes: pipeline.changes,
      agentSessionId: pipeline.sessionId,
      notification: pipeline.notification,
      ...(pipeline.skippedReason ? { skipped: pipeline.skippedReason } : {}),
      ...(pipeline.agentError ? { agentError: pipeline.agentError } : {}),
    });
  } catch (err) {
    console.error("[health-sync]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Demo scenario seed: PUT with preset data for Day 8 of the PRD demo.
 * Used by the "Simulasi Data Hari Ini" button. Accepts both
 * { patient_id } (legacy) and { patientId } (PRD).
 */
export async function PUT(req: NextRequest) {
  try {
    const { supabase, user } = await resolveApiAuth(req);
    if (!user || !supabase) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const patientId: string | undefined = body.patientId ?? body.patient_id;
    const { scenario } = body as { scenario: "baseline_week" | "change_day" };
    if (!patientId) {
      return NextResponse.json({ error: "patientId required" }, { status: 400 });
    }

    const { data: patient } = await supabase
      .from("patients")
      .select("id")
      .eq("id", patientId)
      .eq("caregiver_id", user.id)
      .single();
    if (!patient) return NextResponse.json({ error: "Patient not found" }, { status: 404 });

    const today = new Date();
    const records: Array<{
      patient_id: string;
      data_type: string;
      value: number;
      unit: string;
      recorded_at: string;
      source: string;
    }> = [];

    if (scenario === "baseline_week") {
      // Seed 7 days of "normal" data (Day 1–7)
      for (let d = 7; d >= 1; d--) {
        const date = new Date(today);
        date.setDate(date.getDate() - d);
        const dateStr = date.toISOString().slice(0, 10);
        records.push(
          { patient_id: patientId, data_type: "sleep_hours", value: 7.0 + Math.random() * 0.5, unit: "hours", recorded_at: dateStr, source: "demo_seed" },
          { patient_id: patientId, data_type: "steps", value: 5800 + Math.floor(Math.random() * 600), unit: "count", recorded_at: dateStr, source: "demo_seed" },
          { patient_id: patientId, data_type: "heart_rate", value: 72 + Math.floor(Math.random() * 8), unit: "bpm", recorded_at: dateStr, source: "demo_seed" }
        );
      }
    } else if (scenario === "change_day") {
      // Seed today with "significant change" data (Day 8)
      const todayStr = today.toISOString().slice(0, 10);
      records.push(
        { patient_id: patientId, data_type: "sleep_hours", value: 5.1, unit: "hours", recorded_at: todayStr, source: "demo_seed" },
        { patient_id: patientId, data_type: "steps", value: 2900, unit: "count", recorded_at: todayStr, source: "demo_seed" },
        { patient_id: patientId, data_type: "heart_rate", value: 78, unit: "bpm", recorded_at: todayStr, source: "demo_seed" }
      );
    }

    if (records.length > 0) {
      const { error } = await supabase
        .from("health_data")
        .upsert(records, { onConflict: "patient_id,data_type,recorded_at" });
      if (error) throw error;
    }

    // Demo Day-8: seeding the change day immediately runs the same automatic
    // pipeline as a background sync (detect → agent → notification), so the
    // PRD demo works with one tap and no "Mulai Investigasi" button.
    if (scenario === "change_day") {
      const { data: fullPatient } = await supabase
        .from("patients")
        .select("id, name")
        .eq("id", patientId)
        .single();
      if (fullPatient) {
        const baselineMap = await recalcBaselines(supabase, patientId).catch(() => ({}));
        const pipeline = await runAutomaticPipeline(supabase, fullPatient, baselineMap).catch(
          () => null
        );
        return NextResponse.json({
          ok: true,
          seeded: records.length,
          scenario,
          detected: pipeline?.detected ?? false,
          agentSessionId: pipeline?.sessionId ?? null,
          notification: pipeline?.notification ?? null,
          ...(pipeline?.skippedReason ? { skipped: pipeline.skippedReason } : {}),
          ...(pipeline?.agentError ? { agentError: pipeline.agentError } : {}),
        });
      }
    }

    return NextResponse.json({ ok: true, seeded: records.length, scenario });
  } catch (err) {
    console.error("[health-sync seed]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
