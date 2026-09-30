// shared metric formatting + health overview builder. single source of
// truth for code that used to be copied between the consultation route,
// the summary client, the health page, and the patient health endpoint.

export type HealthMetric = {
  metric: string;
  today_value: number | null;
  today_unit: string | null;
  baseline_value: number | null;
  change_percent: number | null;
  has_data: boolean;
};

/** title-case fallback for unknown metric names. */
export function humanizeMetric(metric: string): string {
  return metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatMetricValue(metric: string, value: number): string {
  if (metric === "steps") return Math.round(value).toLocaleString("id-ID");
  if (metric === "sleep_hours")
    return `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })} jam`;
  if (metric === "heart_rate") return `${Math.round(value)} bpm`;
  return String(value);
}

/** percent change vs baseline, rounded to 1 decimal. prefers stored value. */
export function changePercentValue(baseline: number, current: number, stored?: number): number {
  if (typeof stored === "number" && Number.isFinite(stored)) return stored;
  if (!baseline) return 0;
  return Math.round(((current - baseline) / Math.abs(baseline)) * 1000) / 10;
}

export function formatChangeBadge(pct: number): string {
  const arrow = pct < 0 ? "↓" : pct > 0 ? "↑" : "→";
  return `${arrow} ${Math.abs(pct).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
}

export function buildHealthOverview(
  todayRows: Array<{ data_type: string; value: number; unit: string }>,
  baselineRows: Array<{ metric: string; baseline_value: number }>,
  metrics = ["sleep_hours", "steps", "heart_rate"]
): HealthMetric[] {
  const todayMap: Record<string, { value: number; unit: string }> = {};
  for (const d of todayRows) todayMap[d.data_type] = { value: d.value, unit: d.unit };
  const baselineMap: Record<string, number> = {};
  for (const b of baselineRows) baselineMap[b.metric] = b.baseline_value;

  return metrics.map((metric) => {
    const today = todayMap[metric];
    const baseline = baselineMap[metric];
    return {
      metric,
      today_value: today?.value ?? null,
      today_unit: today?.unit ?? null,
      baseline_value: baseline ?? null,
      change_percent:
        today && baseline != null ? changePercentValue(baseline, today.value) : null,
      has_data: !!today,
    };
  });
}
