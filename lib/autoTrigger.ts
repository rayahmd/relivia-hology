import { runChangeDetection, hasSignificantChange } from "@/lib/changeDetection";
import {
  DEFAULT_QUESTION,
  DEFAULT_QUESTION_FOCUS,
  callGeminiInvestigate,
  parseAgentDecision,
} from "@/lib/agentCore";
import type { NotificationType } from "@/lib/notify";

/** An `investigating` session older than this never resolves — treat as dead. */
export const STALE_INVESTIGATING_MS = 15 * 60 * 1000;

/**
 * Automatic monitoring pipeline (PRD §13–§17, §23–§24).
 *
 *   Health Data → Baseline → Change Detection → [dedup] →
 *   Relivia Agent → NEED MORE INFO? → notification {type, sessionId}
 *
 * Called automatically at the end of POST /api/health-sync — no caregiver
 * button press required (PRD §15, core success criterion §39).
 *
 * Deduplication (PRD §24): one patient may have only ONE active
 * investigation. If a session is already investigating/waiting, no new
 * session and no new notification is created.
 *
 * Gemini failure (PRD §31, strict): the session stays `investigating` with
 * the error recorded in analysis_history. No fake insight is generated.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type AutoPipelineResult = {
  detected: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  changes: any[];
  sessionId: string | null;
  notification: { type: NotificationType; sessionId: string } | null;
  skippedReason?: "no_change" | "session_active" | "agent_unavailable";
  agentError?: string;
};

export async function findActiveSession(
  supabase: Db,
  patientId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  const { data } = await supabase
    .from("agent_sessions")
    .select("id, status, questions_asked, caregiver_responses, current_context, analysis_history, updated_at")
    .eq("patient_id", patientId)
    .in("status", ["investigating", "waiting_for_caregiver"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  // A stale `investigating` session (Gemini died mid-flight) is dead:
  // abandon it so it can never block the pipeline forever.
  if (data.status === "investigating" && Date.now() - new Date(data.updated_at).getTime() > STALE_INVESTIGATING_MS) {
    await supabase
      .from("agent_sessions")
      .update({
        status: "completed",
        analysis_history: [
          ...((data.analysis_history ?? []) as unknown[]),
          { abandoned: true, reason: "stale_investigating_session" },
        ],
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    return null;
  }
  return data;
}

export async function runAutomaticPipeline(
  supabase: Db,
  patient: { id: string; name: string },
  baselineMap: Record<string, number>
): Promise<AutoPipelineResult> {
  const patientId = patient.id;
  const today = new Date().toISOString().slice(0, 10);

  // ── Load today's health + latest check-in ──
  const { data: healthData } = await supabase
    .from("health_data")
    .select("*")
    .eq("patient_id", patientId)
    .order("recorded_at", { ascending: false })
    .limit(9);

  const { data: checkins } = await supabase
    .from("daily_checkins")
    .select("*")
    .eq("patient_id", patientId)
    .order("checkin_date", { ascending: false })
    .limit(7);

  const todayHealth = (healthData ?? []).filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (h: any) => h.recorded_at === today
  );
  const todayCheckin = (checkins ?? [])[0] ?? null;

  const currentMetrics: Record<string, number> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const h of todayHealth as any[]) {
    currentMetrics[h.data_type] = Number(h.value);
  }
  if (todayCheckin) {
    currentMetrics.mood = todayCheckin.mood;
    currentMetrics.sleep_quality = todayCheckin.sleep_quality;
    currentMetrics.social_interaction = todayCheckin.social_interaction;
  }

  // ── Change detection (PRD §13) ──
  const changeResults = runChangeDetection(currentMetrics, baselineMap);
  if (!hasSignificantChange(changeResults)) {
    return { detected: false, changes: changeResults, sessionId: null, notification: null, skippedReason: "no_change" };
  }

  // ── Persist detected changes ──
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

  // ── Deduplication (PRD §24) ──
  const active = await findActiveSession(supabase, patientId);
  if (active) {
    return {
      detected: true,
      changes: changeResults,
      sessionId: active.id,
      notification: null,
      skippedReason: "session_active",
    };
  }

  // ── Create agent session (PRD §15–§16) ──
  const triggerDescription = changeResults
    .filter((r) => r.severity !== "normal")
    .map((r) => `${r.label}: ${r.current_value} (baseline: ${r.baseline_value})`)
    .join(", ");

  const { data: session, error: sessionError } = await supabase
    .from("agent_sessions")
    .insert({
      patient_id: patientId,
      trigger: triggerDescription,
      trigger_source: "automatic_health_sync",
      status: "investigating",
      current_context: {
        changes: changeResults,
        todayCheckin: todayCheckin ?? null,
        baselines: baselineMap,
        triggeredBy: "automatic_health_sync",
      },
      questions_asked: [],
      caregiver_responses: [],
      analysis_history: [],
    })
    .select()
    .single();
  if (sessionError || !session) throw sessionError ?? new Error("Failed to create agent session");

  // ── Agent investigation (PRD §16–§17) ──
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
    // PRD §31 strict, without wedging: record the failure but keep the
    // investigation alive via the default question — a session parked in
    // `investigating` would spin the UI spinner forever and block dedup.
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("agent_sessions")
      .update({
        analysis_history: [{ round: 1, error: "Agent analysis unavailable", detail: message, fallback_question: DEFAULT_QUESTION }],
        status: "waiting_for_caregiver",
        questions_asked: [DEFAULT_QUESTION],
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);
    return {
      detected: true,
      changes: changeResults,
      sessionId: session.id,
      notification: { type: "agent_question", sessionId: session.id },
    };
  }

  const parsed = parseAgentDecision(rawResponse);

  // Guard: `completed` without an insight object strands the caregiver.
  if (!parsed.needs_more_info && !parsed.insight) {
    parsed.needs_more_info = true;
    parsed.question = parsed.question ?? DEFAULT_QUESTION;
    parsed.question_focus = parsed.question_focus ?? DEFAULT_QUESTION_FOCUS;
  }

  await supabase
    .from("agent_sessions")
    .update({
      analysis_history: [{ round: 1, response: parsed, context: contextText }],
      ...(parsed.needs_more_info
        ? { status: "waiting_for_caregiver", questions_asked: [parsed.question] }
        : { status: "completed" }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id);

  if (!parsed.needs_more_info && parsed.insight) {
    await supabase.from("insights").insert({
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
    });
    return {
      detected: true,
      changes: changeResults,
      sessionId: session.id,
      notification: { type: "insight_ready", sessionId: session.id },
    };
  }

  // Agent needs more information → caregiver notification (PRD §21, §23).
  return {
    detected: true,
    changes: changeResults,
    sessionId: session.id,
    notification: { type: "agent_question", sessionId: session.id },
  };
}
