import { buildCheckinsBaselines, buildHealthBaselines } from "@/lib/baseline";

// shared recompute used by the manual button and the health-sync pipeline.
// reads last-30-day data, upserts per-metric baselines, returns the map.
export async function recalcBaselines(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  patientId: string
): Promise<Record<string, number>> {
  const { data: checkins } = await supabase
    .from("daily_checkins")
    .select("mood, sleep_quality, social_interaction")
    .eq("patient_id", patientId)
    .order("checkin_date", { ascending: false })
    .limit(30);

  const { data: healthData } = await supabase
    .from("health_data")
    .select("data_type, value")
    .eq("patient_id", patientId)
    .order("recorded_at", { ascending: false })
    .limit(90);

  const checkinBaselines = buildCheckinsBaselines(
    (checkins ?? []).map(
      (c: { mood: number; sleep_quality: number; social_interaction: number }) => ({
        mood: c.mood,
        sleep_quality: c.sleep_quality,
        social_interaction: c.social_interaction,
      })
    )
  );

  const healthBaselines = buildHealthBaselines(
    (healthData ?? []).map((h: { data_type: string; value: number }) => ({
      data_type: h.data_type,
      value: h.value,
    }))
  );

  const all = [...checkinBaselines, ...healthBaselines];
  for (const b of all) {
    await supabase.from("baselines").upsert(
      {
        patient_id: patientId,
        metric: b.metric,
        baseline_value: b.baseline_value,
        baseline_min: b.baseline_min,
        baseline_max: b.baseline_max,
        sample_count: b.sample_count,
        calculated_at: new Date().toISOString(),
      },
      { onConflict: "patient_id,metric" }
    );
  }

  const map: Record<string, number> = {};
  for (const b of all) map[b.metric] = b.baseline_value;

  // metrics without fresh samples keep their last stored value.
  const { data: stored } = await supabase
    .from("baselines")
    .select("metric, baseline_value")
    .eq("patient_id", patientId);
  for (const s of stored ?? []) {
    if (map[s.metric] == null) map[s.metric] = Number(s.baseline_value);
  }

  return map;
}
