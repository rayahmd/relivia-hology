import { createClient } from "@/lib/supabase/server";
import type { Patient } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

// creates a default patient on first touch so pages never render empty.
export async function getOrCreatePatient(): Promise<Patient> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: existing } = await supabase
    .from("patients")
    .select("*")
    .eq("caregiver_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existing) return existing as Patient;

  const { data: created, error } = await supabase
    .from("patients")
    .insert({ caregiver_id: user.id, name: "Pasien Baru", note: null })
    .select("*")
    .single();

  if (error) throw error;
  return created as Patient;
}

// ownership check shared by api routes. returns null when the patient
// doesn't exist or belongs to another caregiver; callers map that to
// their own 404/403 body so response contracts stay untouched.
export async function getOwnedPatient(
  supabase: Db,
  patientId: string,
  userId: string
): Promise<Patient | null> {
  const { data } = await supabase
    .from("patients")
    .select("*")
    .eq("id", patientId)
    .eq("caregiver_id", userId)
    .single();
  return (data as Patient) ?? null;
}
