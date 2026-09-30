import { getOrCreatePatient } from "@/lib/getOrCreatePatient";
import TopNav from "@/components/TopNav";
import AgentPanel from "@/components/AgentPanel";

export const dynamic = "force-dynamic";

/**
 * /agent — renders the agent session opened via notification deep link
 * /agent?session=<id> (PRD §25–§26). Without a param, the panel resumes
 * the latest active session automatically — no button needed (PRD §39).
 */
export default async function AgentPage({
  searchParams,
}: {
  searchParams: { session?: string };
}) {
  const patient = await getOrCreatePatient();

  // no extra query here — the panel loads its session client-side after
  // the shell paints instantly. the old active-session query is gone: its
  // result was unused but cost one serial roundtrip per visit.

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav patientName={patient.name} patientAge={patient.age} />
      <div className="flex-1 px-4 md:px-[5vw] py-8 max-w-[1180px] mx-auto w-full">
        <div className="mb-6">
          <h2 className="text-2xl font-extrabold mb-1">Relivia Agent</h2>
          <p className="text-sm text-soft">
            AI yang menginvestigasi perubahan kondisi {patient.name} secara otomatis — bertanya jika perlu konteks tambahan.
          </p>
        </div>
        <AgentPanel
          patientId={patient.id}
          patientName={patient.name}
          initialSessionId={searchParams.session ?? null}
        />
      </div>
    </div>
  );
}
