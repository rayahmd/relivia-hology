import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { agentNotificationCopy, agentDeepLink } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/session/:id (PRD §26).
 *
 * Opened via notification deep link /agent?session=<id>.
 * Returns the session state so the Agent page can render the pending
 * question immediately when status = waiting_for_caregiver.
 */
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

    // Verify patient ownership (PRD §35)
    const { data: patient } = await supabase
      .from("patients")
      .select("id, name")
      .eq("id", session.patient_id)
      .eq("caregiver_id", user.id)
      .single();
    if (!patient) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const questions: string[] = session.questions_asked ?? [];
    const responses: string[] = session.caregiver_responses ?? [];
    const lastQuestion = questions.length > 0 ? questions[questions.length - 1] : null;

    // If completed, attach the resulting insight for direct rendering.
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

    const changes =
      (session.current_context as { changes?: unknown[] })?.changes ?? [];

    // Sessions abandoned (stale investigating) or cancelled by the caregiver
    // resolve to `completed` without an insight — flag them so the UI can
    // say so instead of rendering an empty completed state.
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
