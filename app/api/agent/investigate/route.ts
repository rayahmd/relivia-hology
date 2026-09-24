import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runChangeDetection, hasSignificantChange } from "@/lib/changeDetection";
import {
  AGENT_SYSTEM_PROMPT,
  DEFAULT_QUESTION,
  DEFAULT_QUESTION_FOCUS,
  callGeminiInvestigate,
  parseAgentDecision,
} from "@/lib/agentCore";
import { findActiveSession, STALE_INVESTIGATING_MS } from "@/lib/autoTrigger";

// Re-exported for documentation; the prompt lives in lib/agentCore.ts so the
// manual and automatic pipelines share one source of truth (PRD §16).
void AGENT_SYSTEM_PROMPT;

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const patientId: string = body.patient_id;
    if (!patientId) return NextResponse.json({ error: "patient_id required" }, { status: 400 });

    // Verify patient belongs to caregiver
    const { data: patient } = await supabase
      .from("patients")
      .select("*")
      .eq("id", patientId)
      .eq("caregiver_id", user.id)
      .single();
    if (!patient) return NextResponse.json({ error: "Patient not found" }, { status: 404 });

    // Dedup: resume a live session instead of spawning duplicates.
    // A stale `investigating` session (Gemini died mid-flight) is abandoned
    // so it can never wedge the agent in "analyzing" forever.
    const active = await findActiveSession(supabase, patientId);
    if (active) {
      if (active.status === "waiting_for_caregiver") {
        const qs: string[] = active.questions_asked ?? [];
        const ctx = (active.current_context ?? {}) as { changes?: unknown[] };
        return NextResponse.json({
          status: "waiting_for_caregiver",
          session_id: active.id,
          question: qs.length > 0 ? qs[qs.length - 1] : DEFAULT_QUESTION,
          question_focus: "resumed_session",
          changes: ctx.changes ?? [],
        });
      }
      if (active.status === "investigating") {
        const ageMs = Date.now() - new Date(active.updated_at).getTime();
        if (ageMs > STALE_INVESTIGATING_MS) {
          await supabase
            .from("agent_sessions")
            .update({
              status: "completed",
              analysis_history: [
                ...((active.analysis_history ?? []) as unknown[]),
                { abandoned: true, reason: "stale_investigating_session" },
              ],
              updated_at: new Date().toISOString(),
            })
            .eq("id", active.id);
        } else {
          const ctx = (active.current_context ?? {}) as { changes?: unknown[] };
          return NextResponse.json({
            status: "investigating",
            session_id: active.id,
            changes: ctx.changes ?? [],
          });
        }
      }
    }

    // Fetch recent health data (last 3 days)
    const { data: healthData } = await supabase
      .from("health_data")
      .select("*")
      .eq("patient_id", patientId)
      .order("recorded_at", { ascending: false })
      .limit(9); // up to 3 days × 3 metrics

    // Fetch today's & recent check-ins (last 7 days)
    const { data: checkins } = await supabase
      .from("daily_checkins")
      .select("*")
      .eq("patient_id", patientId)
      .order("checkin_date", { ascending: false })
      .limit(7);

    // Fetch baselines
    const { data: baselines } = await supabase
      .from("baselines")
      .select("*")
      .eq("patient_id", patientId);

    const baselineMap: Record<string, number> = {};
    for (const b of baselines ?? []) {
      baselineMap[b.metric] = b.baseline_value;
    }

    // Build current metrics from today's data
    const today = new Date().toISOString().slice(0, 10);
    const todayHealth = (healthData ?? []).filter((h) => h.recorded_at === today);
    const todayCheckin = (checkins ?? [])[0];

    const currentMetrics: Record<string, number> = {};
    for (const h of todayHealth) {
      currentMetrics[h.data_type] = h.value;
    }
    if (todayCheckin) {
      currentMetrics.mood = todayCheckin.mood;
      currentMetrics.sleep_quality = todayCheckin.sleep_quality;
      currentMetrics.social_interaction = todayCheckin.social_interaction;
    }

    // Run change detection
    const changeResults = runChangeDetection(currentMetrics, baselineMap);
    const hasChange = hasSignificantChange(changeResults);

    if (!hasChange) {
      return NextResponse.json({
        status: "no_change",
        message: "Tidak ada perubahan bermakna dari baseline personal pasien.",
        changes: changeResults,
      });
    }

    // Save detected changes to DB
    const changesToSave = changeResults
      .filter((r) => r.severity !== "normal")
      .map((r) => ({
        patient_id: patientId,
        metric: r.metric,
        baseline_value: r.baseline_value,
        current_value: r.current_value,
        change_percent: r.change_percent,
        severity: r.severity,
      }));

    if (changesToSave.length > 0) {
      await supabase.from("detected_changes").insert(changesToSave);
    }

    // Create agent session
    const triggerDescription = changeResults
      .filter((r) => r.severity !== "normal")
      .map((r) => `${r.label}: ${r.current_value} (baseline: ${r.baseline_value})`)
      .join(", ");

    const { data: session, error: sessionError } = await supabase
      .from("agent_sessions")
      .insert({
        patient_id: patientId,
        trigger: triggerDescription,
        trigger_source: "manual",
        status: "investigating",
        current_context: {
          changes: changeResults,
          todayCheckin: todayCheckin ?? null,
          baselines: baselineMap,
        },
        questions_asked: [],
        caregiver_responses: [],
        analysis_history: [],
      })
      .select()
      .single();

    if (sessionError) throw sessionError;

    // Build Gemini context
    const contextText = `
Pasien: ${patient.name}
Tanggal investigasi: ${today}

PERUBAHAN TERDETEKSI (vs personal baseline):
${changeResults
  .map(
    (r) =>
      `- ${r.label}: ${r.current_value} (baseline: ${r.baseline_value}, perubahan: ${r.change_percent > 0 ? "+" : ""}${r.change_percent}%, severity: ${r.severity})`
  )
  .join("\n")}

CATATAN CAREGIVER HARI INI:
${
  todayCheckin
    ? `Mood: ${todayCheckin.mood}/5, Tidur: ${todayCheckin.sleep_quality}/5, Interaksi sosial: ${todayCheckin.social_interaction}/5
Obat: ${todayCheckin.medication_taken ? "Diminum" : "Terlewat"}
Nafsu makan: ${todayCheckin.appetite ?? "tidak diisi"}
Self-care: ${todayCheckin.self_care ?? "tidak diisi"}
Perubahan perilaku: ${todayCheckin.behavior_change ? "Ya" : "Tidak"}
Catatan: ${todayCheckin.free_text_note ?? "-"}`
    : "Belum ada catatan harian hari ini."
}

Apakah kamu membutuhkan informasi tambahan dari caregiver, atau sudah cukup untuk menghasilkan clinical insight?
`;

    let rawResponse: string;
    try {
      rawResponse = await callGeminiInvestigate(contextText);
    } catch (err) {
      // Gemini down → graceful degradation: continue with the default
      // question instead of leaving the session stuck in `investigating`.
      const message = err instanceof Error ? err.message : String(err);
      await supabase
        .from("agent_sessions")
        .update({
          analysis_history: [
            { round: 1, error: "Agent analysis unavailable", detail: message, fallback_question: DEFAULT_QUESTION },
          ],
          status: "waiting_for_caregiver",
          questions_asked: [DEFAULT_QUESTION],
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.id);
      return NextResponse.json({
        status: "waiting_for_caregiver",
        session_id: session.id,
        question: DEFAULT_QUESTION,
        question_focus: DEFAULT_QUESTION_FOCUS,
        changes: changeResults,
        fallback: true,
      });
    }

    const parsed = parseAgentDecision(rawResponse);

    // Guard: a `completed` verdict without an insight object would strand
    // the caregiver (no question rendered). Degrade to the default question.
    if (!parsed.needs_more_info && !parsed.insight) {
      parsed.needs_more_info = true;
      parsed.question = parsed.question ?? DEFAULT_QUESTION;
      parsed.question_focus = parsed.question_focus ?? DEFAULT_QUESTION_FOCUS;
    }

    // Update session with analysis
    await supabase
      .from("agent_sessions")
      .update({
        analysis_history: [{ round: 1, response: parsed, context: contextText }],
        ...(parsed.needs_more_info
          ? {
              status: "waiting_for_caregiver",
              questions_asked: [parsed.question],
            }
          : { status: "completed" }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    if (!parsed.needs_more_info && parsed.insight) {
      // Save insight directly
      const { data: savedInsight } = await supabase
        .from("insights")
        .insert({
          patient_id: patientId,
          agent_session_id: session.id,
          detected_changes: changeResults
            .filter((r) => r.severity !== "normal")
            .map((r) => ({
              metric: r.metric,
              baseline: r.baseline_value,
              current: r.current_value,
              change_percent: r.change_percent,
            })),
          related_factors: parsed.insight.related_factors,
          monitoring_points: parsed.insight.monitoring_points,
          context_notes: parsed.insight.context_notes,
          interpretation: parsed.insight.interpretation,
          summary: parsed.insight.summary,
        })
        .select()
        .single();

      return NextResponse.json({
        status: "completed",
        session_id: session.id,
        insight: savedInsight,
        changes: changeResults,
      });
    }

    return NextResponse.json({
      status: "waiting_for_caregiver",
      session_id: session.id,
      question: parsed.question,
      question_focus: parsed.question_focus,
      changes: changeResults,
    });
  } catch (err) {
    console.error("[agent/investigate]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
