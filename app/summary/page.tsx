import { createClient } from "@/lib/supabase/server";
import { getOrCreatePatient } from "@/lib/getOrCreatePatient";
import TopNav from "@/components/TopNav";
import SummaryClient from "@/components/SummaryClient";
import type { AiInsight, DailyCheckin, ClinicalInsight, ConsultationBrief } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SummaryPage() {
  const supabase = createClient();
  const patient = await getOrCreatePatient();

  // Legacy insight
  const { data: latest } = await supabase
    .from("ai_insights")
    .select("*")
    .eq("patient_id", patient.id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // New agent insight
  const { data: latestNew } = await supabase
    .from("insights")
    .select("*")
    .eq("patient_id", patient.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Latest consultation brief
  const { data: latestBrief } = await supabase
    .from("consultation_briefs")
    .select("*")
    .eq("patient_id", patient.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: checkinsRaw } = await supabase
    .from("daily_checkins")
    .select("*")
    .eq("patient_id", patient.id)
    .order("checkin_date", { ascending: false })
    .limit(30);

  const checkins = ((checkinsRaw ?? []) as DailyCheckin[]).reverse();
  const insight = latest as AiInsight | null;

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav patientName={patient.name} patientAge={patient.age} />
      <div className="flex-1 px-4 md:px-[5vw] py-6 md:py-8">
        <div className="max-w-[560px] mx-auto mb-4">
          <h2 className="text-[22px] leading-tight font-extrabold text-ink mb-1.5">Ringkasan Kesehatan</h2>
          <p className="text-[13px] leading-relaxed text-soft">Halaman ini yang kamu tunjukkan ke psikiater - cetak atau unduh sebagai PDF.</p>
        </div>
        <div className="max-w-[560px] mx-auto">
          <SummaryClient
            checkins={checkins}
            insight={insight}
            agentInsight={(latestNew as ClinicalInsight) ?? null}
            consultationBrief={(latestBrief as ConsultationBrief) ?? null}
            patientName={patient.name}
            patientId={patient.id}
          />
        </div>
      </div>
    </div>
  );
}
