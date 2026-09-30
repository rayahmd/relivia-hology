import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recalcBaselines } from "@/lib/recalcBaseline";
import { getOwnedPatient } from "@/lib/getOrCreatePatient";

// manual baseline recompute. shares one code path with the automatic
// health-sync pipeline. response shape unchanged.
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

    await recalcBaselines(supabase, patientId);

    const { data: stored } = await supabase
      .from("baselines")
      .select("*")
      .eq("patient_id", patientId);

    const { count: checkinCount } = await supabase
      .from("daily_checkins")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patientId);

    const { count: healthCount } = await supabase
      .from("health_data")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patientId);

    return NextResponse.json({
      patient_id: patientId,
      baselines: stored ?? [],
      sample_sizes: {
        checkins: checkinCount ?? 0,
        health_records: healthCount ?? 0,
      },
    });
  } catch (err) {
    console.error("[patient/baseline]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
