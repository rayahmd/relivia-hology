import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildHealthOverview } from "@/lib/metrics";
import { getOwnedPatient } from "@/lib/getOrCreatePatient";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const patientId = params.id;

    const patient = await getOwnedPatient(supabase, patientId, user.id);
    if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // last 30 days of health data
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fromDate = thirtyDaysAgo.toISOString().slice(0, 10);

    const { data: healthData } = await supabase
      .from("health_data")
      .select("*")
      .eq("patient_id", patientId)
      .gte("recorded_at", fromDate)
      .order("recorded_at", { ascending: false });

    const { data: baselines } = await supabase
      .from("baselines")
      .select("*")
      .eq("patient_id", patientId);

    // today's data
    const today = new Date().toISOString().slice(0, 10);
    const todayData = (healthData ?? []).filter((h) => h.recorded_at === today);

    const overview = buildHealthOverview(todayData, baselines ?? []);

    return NextResponse.json({
      patient_id: patientId,
      date: today,
      overview,
      history: healthData ?? [],
    });
  } catch (err) {
    console.error("[patient/health]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
