"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ProfileInput = {
  caregiverName: string;
  city: string;
  patientName: string;
  patientAge: number | null;
};

/**
 * Update caregiver + patient names on the EXISTING data model:
 * profiles.display_name (+city) and patients.name (+age).
 * No new tables — same rows onboarding writes (app/onboarding/actions.ts).
 */
export async function updateProfile(input: ProfileInput) {
  const caregiverName = input.caregiverName.trim();
  const patientName = input.patientName.trim();
  const city = input.city.trim();

  if (!caregiverName) throw new Error("Nama caregiver tidak boleh kosong");
  if (!patientName) throw new Error("Nama pasien tidak boleh kosong");
  if (caregiverName.length > 40) throw new Error("Nama caregiver terlalu panjang (maks 40 karakter)");
  if (patientName.length > 80) throw new Error("Nama pasien terlalu panjang (maks 80 karakter)");
  if (input.patientAge !== null && (isNaN(input.patientAge) || input.patientAge < 1 || input.patientAge > 120)) {
    throw new Error("Umur pasien belum valid");
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ display_name: caregiverName, city: city || null })
    .eq("id", user.id);
  if (profileError) throw profileError;

  const { data: existingPatient } = await supabase
    .from("patients")
    .select("id")
    .eq("caregiver_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existingPatient) {
    const { error } = await supabase
      .from("patients")
      .update({ name: patientName, age: input.patientAge })
      .eq("id", existingPatient.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("patients")
      .insert({ caregiver_id: user.id, name: patientName, age: input.patientAge });
    if (error) throw error;
  }

  // pages below are force-dynamic but revalidate anyway so cached
  // shells pick up the new names immediately.
  for (const p of ["/profile", "/dashboard", "/community", "/agent", "/checkin", "/health", "/insight", "/summary"]) {
    revalidatePath(p);
  }
  return { ok: true };
}
