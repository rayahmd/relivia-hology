import { createClient } from "@/lib/supabase/server";
import { getOrCreatePatient } from "@/lib/getOrCreatePatient";
import { getOrCreateProfile } from "@/lib/getOrCreateProfile";
import TopNav from "@/components/TopNav";
import MonitoringChart from "@/components/MonitoringChart";
import Calendar from "@/components/Calendar";
import Link from "next/link";
import type { DailyCheckin } from "@/lib/types";
import { IconSparkle } from "@/components/Icons";
import Image from "next/image";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();
  // greeting addresses the caregiver (the app user), not the patient.
  const [patient, profile] = await Promise.all([getOrCreatePatient(), getOrCreateProfile()]);
  const today = new Date().toISOString().slice(0, 10);

  // independent queries in parallel (one batched round-trip), not serial.
  const [
    { data: checkinsRaw },
    { data: todayHealth },
    { data: baselines },
    { data: recentChanges },
    { data: activeSession },
    { data: latestInsight },
  ] = await Promise.all([
    supabase
      .from("daily_checkins")
      .select("*")
      .eq("patient_id", patient.id)
      .order("checkin_date", { ascending: false })
      .limit(14),
    supabase
      .from("health_data")
      .select("*")
      .eq("patient_id", patient.id)
      .eq("recorded_at", today),
    supabase
      .from("baselines")
      .select("*")
      .eq("patient_id", patient.id),
    supabase
      .from("detected_changes")
      .select("*")
      .eq("patient_id", patient.id)
      .gte("detected_at", new Date(Date.now() - 86400000 * 2).toISOString())
      .order("detected_at", { ascending: false })
      .limit(5),
    supabase
      .from("agent_sessions")
      .select("*")
      .eq("patient_id", patient.id)
      .in("status", ["investigating", "waiting_for_caregiver"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("insights")
      .select("*")
      .eq("patient_id", patient.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const checkins = ((checkinsRaw ?? []) as DailyCheckin[]).reverse();
  const last7 = checkins.slice(-7);
  const adherence = last7.length
    ? Math.round((last7.filter((c) => c.medication_taken).length / last7.length) * 100)
    : 0;
  const flagCount = checkins.filter((c) => c.behavior_change_flag).length;

  // today's check-in
  const todayCheckin = checkins.find((c) => c.checkin_date === today) ?? null;

  const baselineMap: Record<string, number> = {};
  for (const b of baselines ?? []) baselineMap[b.metric] = b.baseline_value;

  const healthMap: Record<string, { value: number; unit: string }> = {};
  for (const d of todayHealth ?? []) healthMap[d.data_type] = { value: d.value, unit: d.unit };

  const hasChanges = (recentChanges ?? []).length > 0;
  const hasInsight = !!latestInsight;

  let changeStatus: "normal" | "change_detected" | "investigating" | "insight_ready" = "normal";
  if (hasInsight) changeStatus = "insight_ready";
  else if (activeSession) changeStatus = "investigating";
  else if (hasChanges) changeStatus = "change_detected";

  const STATUS_CONFIG = {
    normal: { label: "Tidak ada perubahan signifikan", badgeBg: "bg-[#D1FAE5] border-[#A7F3D0] text-[#065F46]", dot: "bg-[#10B981]" },
    change_detected: { label: "Perubahan terdeteksi", badgeBg: "bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]", dot: "bg-[#F59E0B]" },
    investigating: { label: "Agent sedang menginvestigasi", badgeBg: "bg-[#E0E7FF] border-[#C7D2FE] text-[#3730A3]", dot: "bg-[#6366F1] animate-pulse" },
    insight_ready: { label: "Insight siap ditinjau", badgeBg: "bg-[#D1FAE5] border-[#A7F3D0] text-[#065F46]", dot: "bg-[#10B981]" },
  };
  const statusCfg = STATUS_CONFIG[changeStatus];

  // time-based greeting
  const hour = new Date().getHours();
  let timeGreeting = "Good Morning,";
  if (hour >= 12 && hour < 17) timeGreeting = "Good Afternoon,";
  else if (hour >= 17) timeGreeting = "Good Evening,";

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8FF]">
      <TopNav patientName={patient.name} patientAge={patient.age} />

      <div className="flex-1 px-4 sm:px-6 md:px-8 py-6 max-w-[540px] md:max-w-[760px] lg:max-w-[960px] mx-auto w-full space-y-4">

        {/* greeting */}
        <div className="pt-2 pb-1">
          <p className="text-sm font-bold text-[#8B5CF6] tracking-tight">{timeGreeting}</p>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#7C3AED] tracking-tight mt-0.5">
            {profile.display_name}
          </h1>
        </div>

        {/* patient card + check-in link */}
        <div className="bg-white rounded-3xl p-4 sm:p-5 border border-purple-100 shadow-sm flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#8B5CF6] to-[#C4B5FD] text-white flex items-center justify-center font-extrabold text-xl flex-none ring-2 ring-purple-100 shadow-sm overflow-hidden">
              {patient.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <h2 className="font-extrabold text-[#7C3AED] text-base sm:text-lg truncate leading-tight">
                {patient.name}
              </h2>
              {patient.age && (
                <p className="text-xs text-gray-500 font-medium">{patient.age} tahun</p>
              )}
              <p className="text-[11px] text-gray-400 font-medium mt-0.5">
                {todayCheckin ? "Sudah Check-In Hari Ini" : "Belum Check - In Hari Ini"}
              </p>
            </div>
          </div>
          <Link
            href="/checkin"
            className="text-sm sm:text-base font-extrabold text-[#7C3AED] hover:text-[#6D28D9] hover:underline flex-none transition"
          >
            Check - In
          </Link>
        </div>

        {/* monitoring status */}
        <div className="bg-white rounded-3xl p-4 sm:p-5 border border-gray-100 shadow-sm">
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-2.5">
            STATUS PEMANTAUAN
          </span>
          <div className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-full font-bold text-xs sm:text-sm border ${statusCfg.badgeBg}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${statusCfg.dot}`} />
            <span>{statusCfg.label}</span>
          </div>

          {changeStatus === "change_detected" && (
            <div className="mt-3">
              <Link href="/agent" className="text-xs font-bold text-[#7C3AED] hover:underline">
                Lihat Status Monitoring →
              </Link>
            </div>
          )}
          {changeStatus === "investigating" && (
            <div className="mt-3">
              <Link href="/agent" className="text-xs font-bold text-[#7C3AED] hover:underline">
                Lihat Investigasi →
              </Link>
            </div>
          )}
          {changeStatus === "insight_ready" && (
            <div className="mt-3">
              <Link href="/insight" className="text-xs font-bold text-[#059669] hover:underline">
                Lihat Insight →
              </Link>
            </div>
          )}
        </div>

        {/* stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <StatCard icon="/images/icons/medicine-box.svg" iconSize={120} value={`${adherence}%`} label="Kepatuhan obat 7 hari" />
          <StatCard icon="/images/icons/tabler_comet.svg" iconSize={140} value={String(checkins.length)} label="Hari tercatat" />
          <StatCard icon="/images/icons/warning.svg" iconSize={140} value={String(flagCount)} label="Hari ditandai berubah" />
        </div>

        {/* cta pills */}
        <div className="flex flex-wrap justify-center gap-3 pt-1 pb-1">
          <Link
            href="/checkin"
            className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-extrabold rounded-full px-6 py-3 text-sm shadow-md transition-all active:scale-95"
          >
            Catatan Harian
          </Link>
          <Link
            href="/health"
            className="bg-[#E9D5FF] hover:bg-[#DDD6FE] text-[#7C3AED] font-extrabold rounded-full px-6 py-3 text-sm transition-all active:scale-95"
          >
            Data Kesehatan
          </Link>
        </div>

        {/* monitoring chart */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-100">
            <h3 className="font-extrabold text-base text-gray-900 mb-2">Grafik Pemantauan</h3>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600 font-semibold">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-1 bg-[#8B5CF6] rounded-full inline-block" /> Mood
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-1 bg-[#F97316] rounded-full inline-block" /> Tidur
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#10B981] inline-block" /> Obat Diminum
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#EF4444] inline-block" /> Terlewat
              </span>
            </div>
          </div>
          <div className="py-2">
            <MonitoringChart checkins={checkins} />
          </div>
        </div>

        {/* recording calendar */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-100">
            <h3 className="font-extrabold text-base text-gray-900">Kalender Pencatatan</h3>
          </div>
          <Calendar checkins={checkins} />
        </div>

        {/* daily log */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-100">
            <h3 className="font-extrabold text-base text-gray-900">Log Harian</h3>
          </div>
          <div>
            {checkins.length === 0 ? (
              <div className="p-6 text-center text-xs sm:text-sm text-gray-500 font-medium leading-relaxed">
                Belum ada catatan harian yang tersimpan. Klik "Catatan Harian" di atas untuk menambah data baru.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {checkins.slice().reverse().map((c) => (
                  <li
                    key={c.id}
                    id={`log-${c.checkin_date}`}
                    className="p-4 sm:p-5 flex items-start justify-between gap-3 hover:bg-purple-50/40 transition"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-extrabold text-gray-900">{c.checkin_date}</span>
                        {c.behavior_change_flag && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                            berubah dari pola
                          </span>
                        )}
                        {!c.medication_taken && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                            obat terlewat
                          </span>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm text-gray-600 leading-relaxed font-medium">
                        {c.free_text_note || "Tidak ada catatan tambahan."}
                      </p>
                    </div>
                    <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-none ${c.medication_taken ? "bg-[#10B981]" : "bg-[#EF4444]"}`} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// icon as background layer (absolute, z-0), text in front (z-10) with left
// padding so it never collides with the icon.
function StatCard({ icon, iconSize, value, label }: { icon: string; iconSize: number; value: string; label: string }) {
  return (
    <div className="bg-gradient-to-br from-[#FFF4BF] to-[#FFBEFB] rounded-3xl p-4 sm:p-5 relative overflow-hidden shadow-sm">
      <div className="absolute left-0 bottom-0 z-0 opacity-90">
        <Image src={icon} alt="" width={iconSize} height={iconSize} />
      </div>
      <div className="relative z-10 pl-24">
        <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">{value}</div>
        <div className="text-xs text-gray-600 font-medium leading-tight">{label}</div>
      </div>
    </div>
  );
}
