import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreatePatient } from "@/lib/getOrCreatePatient";
import { agentNotificationCopy, agentDeepLink } from "@/lib/notify";

export const dynamic = "force-dynamic";

// polled by the auto monitor + native layer. returns pending triggers:
//   waiting_for_caregiver → agent_question
//   completed (≤24h, has insight) → insight_ready
// dedup: at most one notification per active session.
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const patient = await getOrCreatePatient();
    const since = req.nextUrl.searchParams.get("since");

    let query = supabase
      .from("agent_sessions")
      .select("id, status, updated_at, created_at")
      .eq("patient_id", patient.id)
      .in("status", ["waiting_for_caregiver", "completed"])
      .order("updated_at", { ascending: false })
      .limit(5);

    if (since) query = query.gte("updated_at", since);

    const { data: sessions } = await query;

    const notifications: Array<{
      type: "agent_question" | "insight_ready";
      sessionId: string;
      title: string;
      body: string;
      deep_link: string;
      updated_at: string;
    }> = [];

    for (const s of sessions ?? []) {
      if (s.status === "waiting_for_caregiver") {
        const copy = agentNotificationCopy("agent_question");
        notifications.push({
          type: "agent_question",
          sessionId: s.id,
          title: copy.title,
          body: copy.body,
          deep_link: agentDeepLink(s.id),
          updated_at: s.updated_at,
        });
      } else if (s.status === "completed") {
        // only freshly completed sessions (≤24h) that produced an insight.
        const ageMs = Date.now() - new Date(s.updated_at).getTime();
        if (ageMs > 24 * 3600 * 1000) continue;
        const { data: insight } = await supabase
          .from("insights")
          .select("id")
          .eq("agent_session_id", s.id)
          .limit(1)
          .maybeSingle();
        if (!insight) continue;
        const copy = agentNotificationCopy("insight_ready");
        notifications.push({
          type: "insight_ready",
          sessionId: s.id,
          title: copy.title,
          body: copy.body,
          deep_link: agentDeepLink(s.id),
          updated_at: s.updated_at,
        });
      }
    }

    return NextResponse.json({ notifications });
  } catch (err) {
    console.error("[notifications/dispatch]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
