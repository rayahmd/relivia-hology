import { getOrCreateProfile } from "@/lib/getOrCreateProfile";
import { getOrCreatePatient } from "@/lib/getOrCreatePatient";
import TopNav from "@/components/TopNav";
import ProfileForm from "@/components/ProfileForm";

export const dynamic = "force-dynamic";

/**
 * /profile — caregiver + patient names, view/edit.
 * Reads the same rows onboarding writes (profiles + patients), so edits
 * propagate to every page that renders patient.name on next load.
 */
export default async function ProfilePage() {
  const [profile, patient] = await Promise.all([getOrCreateProfile(), getOrCreatePatient()]);

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav patientName={patient.name} patientAge={patient.age} />
      <div className="flex-1 px-4 md:px-[5vw] py-8 max-w-[720px] mx-auto w-full">
        <div className="mb-6">
          <h2 className="text-2xl font-extrabold mb-1">Profil</h2>
          <p className="text-sm text-soft">
            Nama caregiver dan pasien yang tampil di seluruh aplikasi Relivia.
          </p>
        </div>
        <ProfileForm
          initialCaregiverName={profile.display_name}
          initialCity={profile.city ?? ""}
          initialPatientName={patient.name}
          initialPatientAge={patient.age}
        />
      </div>
    </div>
  );
}
