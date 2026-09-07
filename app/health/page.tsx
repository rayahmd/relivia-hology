import { createClient } from "@/lib/supabase/server";
import { getOrCreatePatient } from "@/lib/getOrCreatePatient";
import TopNav from "@/components/TopNav";
import HealthDataCard from "@/components/HealthDataCard";
import MonitoringCard from "@/components/MonitoringCard";

export const dynamic = "force-dynamic";

const METRICS = ["sleep_hours", "steps", "heart_rate"];

export default async function HealthPage() {
  const supabase = createClient();
  const patient = await getOrCreatePatient();

  const today = new Date().toISOString().slice(0, 10);

  // Fetch today's health data
  const { data: todayData } = await supabase
    .from("health_data")
    .select("*")
    .eq("patient_id", patient.id)
    .eq("recorded_at", today);

  // Fetch baselines
  const { data: baselines } = await supabase
    .from("baselines")
    .select("*")
    .eq("patient_id", patient.id);

  const baselineMap: Record<string, { value: number }> = {};
  for (const b of baselines ?? []) {
    baselineMap[b.metric] = { value: b.baseline_value };
  }

  const todayMap: Record<string, { value: number; unit: string }> = {};
  for (const d of todayData ?? []) {
    todayMap[d.data_type] = { value: d.value, unit: d.unit };
  }

  const metrics = METRICS.map((metric) => {
    const today_val = todayMap[metric];
    const baseline = baselineMap[metric];
    let change_percent: number | null = null;
    if (today_val && baseline) {
      change_percent =
        Math.round(((today_val.value - baseline.value) / baseline.value) * 1000) / 10;
    }
    return {
      metric,
      today_value: today_val?.value ?? null,
      today_unit: today_val?.unit ?? null,
      baseline_value: baseline?.value ?? null,
      change_percent,
      has_data: !!today_val,
    };
  });

  // Fetch 30-day history
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const { data: historyData } = await supabase
    .from("health_data")
    .select("*")
    .eq("patient_id", patient.id)
    .gte("recorded_at", thirtyDaysAgo.toISOString().slice(0, 10))
    .order("recorded_at", { ascending: false });

  const hasData = (historyData ?? []).length > 0;

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav patientName={patient.name} patientAge={patient.age} />
      <div className="flex-1 px-4 md:px-[5vw] py-8 max-w-[1180px] mx-auto w-full">
        <div className="mb-4">
          <h2 className="text-[22px] font-extrabold mb-1 tracking-tight">Data Kesehatan</h2>
          <p className="text-[12px] leading-relaxed text-[#3B82F6]">
            Data dari Health Connect dibandingkan dengan baseline personal {patient.name}.
          </p>
        </div>

        <MonitoringCard patientId={patient.id} />

        {!hasData && (
          <div className="card p-6 mb-5 border-2 border-dashed border-border text-center">
            <div className="text-3xl mb-3">📡</div>
            <h3 className="font-bold mb-1">Belum ada data kesehatan</h3>
            <p className="text-sm text-soft max-w-[380px] mx-auto">
              Data kesehatan belum tersinkronisasi. Aktifkan monitoring di atas, atau muat contoh data di bawah untuk melihat cara kerja Relivia.
            </p>
          </div>
        )}

        <HealthDataCard metrics={metrics} patientId={patient.id} />

        {/* History Table */}
        {hasData && (
          <div className="card mt-6">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="font-extrabold">Riwayat 30 Hari Terakhir</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-faint font-bold uppercase border-b border-border">
                    <th className="px-5 py-3">Tanggal</th>
                    <th className="px-5 py-3">Metrik</th>
                    <th className="px-5 py-3">Nilai</th>
                    <th className="px-5 py-3">Sumber</th>
                  </tr>
                </thead>
                <tbody>
                  {(historyData ?? []).slice(0, 30).map((d) => (
                    <tr key={d.id} className="border-t border-border/60 hover:bg-bg transition">
                      <td className="px-5 py-3 text-faint font-mono">{d.recorded_at}</td>
                      <td className="px-5 py-3 font-medium capitalize">{d.data_type.replace(/_/g, " ")}</td>
                      <td className="px-5 py-3 font-bold">{d.value} <span className="font-normal text-faint">{d.unit}</span></td>
                      <td className="px-5 py-3">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg text-faint font-medium">{d.source}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
