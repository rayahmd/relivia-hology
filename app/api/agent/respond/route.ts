import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_QUESTION,
  DEFAULT_QUESTION_FOCUS,
  cleanGeminiJson,
  extractGeminiText,
  getFallbackAnswerOptions,
  normalizeAnswerOptions,
  postGemini,
  withAppendedOptions,
  type AgentDecision,
  type AgentSessionContext,
} from "@/lib/agentCore";
import { getOwnedPatient } from "@/lib/getOrCreatePatient";

const REANALYSIS_SYSTEM_PROMPT = `You are Relivia Agent. You are re-analyzing patient behavioral change data after receiving additional context from the caregiver.

CRITICAL SAFETY RULES:
- NEVER use words like "relapse", "kambuh", "diagnosis"
- NEVER state the patient is definitely deteriorating  
- NEVER give medication advice
- Use phrases: "meaningful change from baseline", "pattern worth discussing with a psychiatrist"
- Maximum 3 follow-up questions total across the entire session

You will receive the full investigation context including previous questions and caregiver answers.

Determine if you have enough context now, or if you need ONE more question (only if questions asked < 3).

Respond with ONLY valid JSON:

If you need ONE more question (and fewer than 3 have been asked):
{
  "needs_more_info": true,
  "question": "Focused question in Bahasa Indonesia",
  "question_focus": "what gap this addresses",
  "answer_options": ["option 1 in Bahasa Indonesia", "option 2", "option 3"]
}

RULES FOR answer_options: 2-4 short options (max ~40 chars), each directly
answering THIS question (sleep→sleep answers, medication→medication
answers, never one generic template). Natural, non-leading; include an
uncertainty option ("Tidak terlalu yakin") when it fits. Free-text answers
are always allowed, options are shortcuts.

If you have enough information:
{
  "needs_more_info": false,
  "insight": {
    "summary": "2-3 sentence summary in Bahasa Indonesia",
    "detected_changes": ["change 1", "change 2"],
    "related_factors": ["factor 1", "factor 2"],
    "monitoring_points": ["monitor point 1", "monitor point 2"],
    "interpretation": "Factual 1-2 sentence interpretation in Bahasa Indonesia",
    "context_notes": "Summary of caregiver-provided context"
  }
}`;

async function callGemini(messages: unknown[]): Promise<string> {
  const res = await postGemini({
    systemPrompt: REANALYSIS_SYSTEM_PROMPT,
    contents: messages as { role: string; parts: Array<{ text: string }> }[],
    maxOutputTokens: 1200,
    temperature: 0.3,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }

  return extractGeminiText(await res.json());
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await req.json();
    const { session_id, answer } = body as { session_id: string; answer: string };

    if (!session_id || !answer) {
      return NextResponse.json({ error: "session_id and answer are required" }, { status: 400 });
    }

    // load session
    const { data: session, error: sessionErr } = await supabase
      .from("agent_sessions")
      .select("*")
      .eq("id", session_id)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // patient belongs to caregiver
    const patient = await getOwnedPatient(supabase, session.patient_id, user.id);
    if (!patient) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // max 3 questions
    const questionsAsked: string[] = session.questions_asked ?? [];
    const caregiverResponses: string[] = session.caregiver_responses ?? [];
    const MAX_QUESTIONS = 3;

    const updatedResponses = [...caregiverResponses, answer];

    // conversation context for re-analysis
    const ctx = session.current_context as AgentSessionContext;

    const qaHistory = questionsAsked
      .map((q, i) => `Pertanyaan ${i + 1}: ${q}\nJawaban caregiver: ${updatedResponses[i] ?? "(belum dijawab)"}`)
      .join("\n\n");

    const contextText = `
KONTEKS INVESTIGASI:
Pasien: ${patient.name}
Pertanyaan yang sudah diajukan: ${questionsAsked.length} dari ${MAX_QUESTIONS}

PERUBAHAN TERDETEKSI:
${(ctx.changes ?? [])
  .map(
    (r) =>
      `- ${r.label ?? r.metric}: ${r.current_value} (baseline: ${r.baseline_value}, ${r.change_percent > 0 ? "+" : ""}${r.change_percent}%, severity: ${r.severity})`
  )
  .join("\n")}

RIWAYAT PERTANYAAN & JAWABAN:
${qaHistory}

${questionsAsked.length >= MAX_QUESTIONS ? "BATAS PERTANYAAN TERCAPAI. Hasilkan insight sekarang." : ""}

Apakah kamu sudah memiliki cukup konteks untuk menghasilkan clinical insight?
`;

    const rawResponse = await callGemini([
      { role: "user", parts: [{ text: contextText }] },
    ]).catch((err) => {
      // gemini down mid-conversation: never 500 into a dead end.
      // ask the default question (quota permitting) or finish deterministically.
      const message = err instanceof Error ? err.message : String(err);
      const lastQ = questionsAsked[questionsAsked.length - 1];
      if (questionsAsked.length < MAX_QUESTIONS && lastQ !== DEFAULT_QUESTION) {
        return JSON.stringify({
          needs_more_info: true,
          question: DEFAULT_QUESTION,
          question_focus: `${DEFAULT_QUESTION_FOCUS} (fallback_after_error: ${message.slice(0, 120)})`,
          answer_options: getFallbackAnswerOptions(DEFAULT_QUESTION, DEFAULT_QUESTION_FOCUS),
        });
      }
      return JSON.stringify({ needs_more_info: false });
    });

    let parsed: AgentDecision;

    try {
      parsed = JSON.parse(cleanGeminiJson(rawResponse));
    } catch {
      parsed = { needs_more_info: false, insight: undefined };
    }

    // force completion once max questions reached
    if (questionsAsked.length >= MAX_QUESTIONS) {
      parsed.needs_more_info = false;
    }

    // `needs_more_info` without a question strands the caregiver.
    if (parsed.needs_more_info && !parsed.question) {
      parsed.question = DEFAULT_QUESTION;
      parsed.question_focus = DEFAULT_QUESTION_FOCUS;
    }

    if (parsed.needs_more_info && parsed.question) {
      const updatedQuestions = [...questionsAsked, parsed.question];
      const newOptions = normalizeAnswerOptions(parsed.answer_options, parsed.question, parsed.question_focus);

      await supabase
        .from("agent_sessions")
        .update({
          status: "waiting_for_caregiver",
          questions_asked: updatedQuestions,
          caregiver_responses: updatedResponses,
          current_context: withAppendedOptions(ctx, newOptions),
          analysis_history: [
            ...(session.analysis_history ?? []),
            { round: updatedQuestions.length, question: parsed.question, context: contextText },
          ],
          updated_at: new Date().toISOString(),
        })
        .eq("id", session_id);

      return NextResponse.json({
        status: "waiting_for_caregiver",
        session_id,
        question: parsed.question,
        question_focus: parsed.question_focus,
        answer_options: newOptions,
        questions_count: updatedQuestions.length,
      });
    }

    // insight with deterministic defaults when the model gave none
    const insightData = parsed.insight ?? {
      summary: "Terdapat perubahan bermakna dari pola perilaku biasanya. Perlu didiskusikan dengan tenaga kesehatan.",
      detected_changes: [],
      related_factors: [],
      monitoring_points: ["Pantau tidur, aktivitas, dan interaksi sosial"],
      interpretation: "Pola ini berbeda dari baseline personal pasien.",
      context_notes: updatedResponses.join("; "),
    };

    const { data: savedInsight } = await supabase
      .from("insights")
      .insert({
        patient_id: session.patient_id,
        agent_session_id: session_id,
        detected_changes: (ctx.changes ?? [])
          .filter((r) => r.severity !== "normal")
          .map((r) => ({
            metric: r.metric,
            baseline: r.baseline_value,
            current: r.current_value,
            change_percent: r.change_percent,
          })),
        related_factors: insightData.related_factors,
        monitoring_points: insightData.monitoring_points,
        context_notes: insightData.context_notes,
        interpretation: insightData.interpretation,
        summary: insightData.summary,
      })
      .select()
      .single();

    await supabase
      .from("agent_sessions")
      .update({
        status: "completed",
        caregiver_responses: updatedResponses,
        analysis_history: [
          ...(session.analysis_history ?? []),
          { round: "final", insight: insightData },
        ],
        updated_at: new Date().toISOString(),
      })
      .eq("id", session_id);

    return NextResponse.json({
      status: "completed",
      session_id,
      insight: savedInsight,
    });
  } catch (err) {
    console.error("[agent/respond]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
