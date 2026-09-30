import { NextRequest, NextResponse } from "next/server";
import { resolveApiAuth } from "@/lib/supabase/bearer";
import { recalcBaselines } from "@/lib/recalcBaseline";
import { runAutomaticPipeline } from "@/lib/autoTrigger";
import { getOwnedPatient } from "@/lib/getOrCreatePatient";

const ALLOWED_TYPES = new Set(["sleep_hours", "steps", "heart_rate"]);
const ALLOWED_SOURCES = new Set([
  "health_connect",
  "health_connect_simulation",
  "manual",
  "simulation",
  "demo_seed",
]);

type HealthRecord = {
  patient_id: string;
  data_type: string;
  value: number;
  unit: string;
  recorded_at: string;
  source: string;
};

// POST /api/health-sync.
//
// accepts both the prd contract (camelCase):
//   { patientId, source, data: [{ dataType, value, unit, recordedAt }] }
// and the legacy web contract (snake_case):
//   { patient_id, data: [{ data_type, value, unit, recorded_at }] }
//
// pipeline per sync:
//   store → recalc baseline → change detection → agent trigger.
//
// auth: session cookie (browser/webview) or bearer token (native worker).
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await resolveApiAuth(req);
    if (!user || !supabase) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    // dual-format normalization + backward compat
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
    const records: HealthRecord[] = [];

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

    const patient = await getOwnedPatient(supabase, patientId, user.id);
    if (!patient) return NextResponse.json({ error: "Patient not found" }, { status: 404 });

    const { error } = await supabase
      .from("health_data")
      .upsert(records, { onConflict: "patient_id,data_type,recorded_at" });
    if (error) throw error;

    // baseline refresh + automatic pipeline
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
      // storage already succeeded — report sync ok with pipeline error.
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

// demo seed: PUT with preset data for the demo day scenario. used by the
// simulation button. accepts both { patient_id } and { patientId }.
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

    const patient = await getOwnedPatient(supabase, patientId, user.id);
    if (!patient) return NextResponse.json({ error: "Patient not found" }, { status: 404 });

    const today = new Date();
    const records: HealthRecord[] = [];

    if (scenario === "baseline_week") {
      // seed 7 days of normal data
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
      // seed today with significant-change data
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

    // seeding the change day runs the same automatic pipeline as a
    // background sync, so the demo works with one tap.
    if (scenario === "change_day") {
      const baselineMap = await recalcBaselines(supabase, patientId).catch(() => ({}));
      const pipeline = await runAutomaticPipeline(supabase, patient, baselineMap).catch(
        () => null
      );
      // dedup (session still active): frontend needs the session status to
      // re-show the right banner (agent_question vs insight_ready).
      let sessionStatus: string | null = null;
      if (pipeline?.sessionId) {
        const { data: s } = await supabase
          .from("agent_sessions")
          .select("status")
          .eq("id", pipeline.sessionId)
          .maybeSingle();
        sessionStatus = (s as { status?: string } | null)?.status ?? null;
      }
      return NextResponse.json({
        ok: true,
        seeded: records.length,
        scenario,
        detected: pipeline?.detected ?? false,
        agentSessionId: pipeline?.sessionId ?? null,
        notification: pipeline?.notification ?? null,
        ...(pipeline?.skippedReason ? { skipped: pipeline.skippedReason } : {}),
        ...(sessionStatus ? { sessionStatus } : {}),
        ...(pipeline?.agentError ? { agentError: pipeline.agentError } : {}),
      });
    }

    return NextResponse.json({ ok: true, seeded: records.length, scenario });
  } catch (err) {
    console.error("[health-sync seed]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
