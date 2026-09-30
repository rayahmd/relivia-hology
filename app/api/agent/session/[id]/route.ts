import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { agentNotificationCopy, agentDeepLink } from "@/lib/notify";
import { getFallbackAnswerOptions, getStoredOptions, type AgentSessionContext } from "@/lib/agentCore";
import { getOwnedPatient } from "@/lib/getOrCreatePatient";

export const dynamic = "force-dynamic";

// opened via notification deep link /agent?session=<id>. returns the
// session state so the agent page renders the pending question immediately.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: session } = await supabase
      .from("agent_sessions")
      .select("*")
      .eq("id", params.id)
      .single();

    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    // verify patient ownership
    const patient = await getOwnedPatient(supabase, session.patient_id, user.id);
    if (!patient) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const questions: string[] = session.questions_asked ?? [];
    const responses: string[] = session.caregiver_responses ?? [];
    const lastQuestion = questions.length > 0 ? questions[questions.length - 1] : null;

    // attach the insight when completed, for direct rendering.
    let insight = null;
    if (session.status === "completed") {
      const { data } = await supabase
        .from("insights")
        .select("*")
        .eq("agent_session_id", session.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      insight = data ?? null;
    }

    const ctx = (session.current_context ?? {}) as AgentSessionContext;
    const changes = ctx.changes ?? [];

    // answer options travel with the question (stored per round). old
    // sessions without stored options get a topic fallback instead.
    const lastOptions =
      getStoredOptions(ctx, questions.length - 1) ??
      (lastQuestion ? getFallbackAnswerOptions(lastQuestion) : []);

    // abandoned or cancelled sessions resolve to completed without an
    // insight — flag them so the ui says so instead of rendering empty.
    const history = (session.analysis_history ?? []) as Array<Record<string, unknown>>;
    const cancelled = history.some((h) => h?.abandoned === true || h?.cancelled === true);

    return NextResponse.json({
      session: {
        id: session.id,
        patient_id: session.patient_id,
        status: session.status,
        cancelled,
        trigger: session.trigger,
        questions_count: questions.length,
        max_questions: 3,
        last_question: session.status === "waiting_for_caregiver" ? lastQuestion : null,
        last_options: session.status === "waiting_for_caregiver" ? lastOptions : [],
        questions_asked: questions,
        responses_count: responses.length,
        changes,
        created_at: session.created_at,
        updated_at: session.updated_at,
      },
      patient: { id: patient.id, name: patient.name },
      insight,
      deep_link: agentDeepLink(session.id),
      notification_copy: agentNotificationCopy(
        session.status === "completed" ? "insight_ready" : "agent_question"
      ),
    });
  } catch (err) {
    console.error("[agent/session]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
