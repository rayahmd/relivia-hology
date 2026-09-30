import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOwnedPatient } from "@/lib/getOrCreatePatient";

// abandon a wedged session (e.g. stuck investigating). the status check
// only allows investigating/waiting/completed, so cancellation resolves
// to completed with a marker in analysis_history.
export async function POST(
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
      .select("id, patient_id, status, analysis_history")
      .eq("id", params.id)
      .single();
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const patient = await getOwnedPatient(supabase, session.patient_id, user.id);
    if (!patient) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await supabase
      .from("agent_sessions")
      .update({
        status: "completed",
        analysis_history: [
          ...((session.analysis_history ?? []) as unknown[]),
          { cancelled: true, at: new Date().toISOString() },
        ],
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    return NextResponse.json({ ok: true, session_id: session.id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
