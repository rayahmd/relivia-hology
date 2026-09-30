/**
 * patient-specific baseline calculation from the last N days of data:
 * average, min, and max per numeric metric.
 */

export type MetricSamples = {
  metric: string;
  values: number[];
};

export type CalculatedBaseline = {
  metric: string;
  baseline_value: number; // average
  baseline_min: number;
  baseline_max: number;
  sample_count: number;
};

/**
 * baseline from numeric values. null when fewer than minSamples.
 */
export function computeBaseline(
  metric: string,
  values: number[],
  minSamples = 3
): CalculatedBaseline | null {
  const valid = values.filter((v) => v != null && !isNaN(v) && v > 0);
  if (valid.length < minSamples) return null;

  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  const min = Math.min(...valid);
  const max = Math.max(...valid);

  return {
    metric,
    baseline_value: Math.round(avg * 100) / 100,
    baseline_min: Math.round(min * 100) / 100,
    baseline_max: Math.round(max * 100) / 100,
    sample_count: valid.length,
  };
}

/**
 * baselines from check-in history. maps checkin fields to metric names.
 */
export function buildCheckinsBaselines(
  checkins: Array<{
    mood: number;
    sleep_quality: number;
    social_interaction: number;
  }>
): CalculatedBaseline[] {
  const result: CalculatedBaseline[] = [];

  const mood = computeBaseline("mood", checkins.map((c) => c.mood));
  const sleep = computeBaseline("sleep_quality", checkins.map((c) => c.sleep_quality));
  const social = computeBaseline("social_interaction", checkins.map((c) => c.social_interaction));

  if (mood) result.push(mood);
  if (sleep) result.push(sleep);
  if (social) result.push(social);

  return result;
}

/**
 * baselines from health data history, grouped by data_type.
 */
export function buildHealthBaselines(
  healthData: Array<{ data_type: string; value: number }>
): CalculatedBaseline[] {
  const grouped: Record<string, number[]> = {};
  for (const d of healthData) {
    if (!grouped[d.data_type]) grouped[d.data_type] = [];
    grouped[d.data_type].push(d.value);
  }

  const result: CalculatedBaseline[] = [];
  for (const [metric, values] of Object.entries(grouped)) {
    const b = computeBaseline(metric, values);
    if (b) result.push(b);
  }
  return result;
}
