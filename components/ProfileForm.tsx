"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateProfile } from "@/app/profile/actions";

const inputCls =
  "w-full border-2 border-border rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:border-primary";
const labelCls = "block text-xs font-bold text-soft mb-1.5";

/**
 * Profile view/edit — same visual language as onboarding + dashboard cards
 * (.card, .btn-primary, same label/input classes). View mode shows rows,
 * edit mode reuses the onboarding form look. Persisted via updateProfile
 * server action (profiles + patients rows), so data survives reload.
 */
export default function ProfileForm({
  initialCaregiverName,
  initialCity,
  initialPatientName,
  initialPatientAge,
}: {
  initialCaregiverName: string;
  initialCity: string;
  initialPatientName: string;
  initialPatientAge: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [caregiverName, setCaregiverName] = useState(initialCaregiverName);
  const [city, setCity] = useState(initialCity);
  const [patientName, setPatientName] = useState(initialPatientName);
  const [patientAge, setPatientAge] = useState(initialPatientAge?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setEditing(true);
    setError(null);
    setSaved(false);
  }

  function cancelEdit() {
    setCaregiverName(initialCaregiverName);
    setCity(initialCity);
    setPatientName(initialPatientName);
    setPatientAge(initialPatientAge?.toString() ?? "");
    setError(null);
    setEditing(false);
  }

  async function handleSave() {
    if (!caregiverName.trim() || !patientName.trim()) {
      setError("Nama caregiver dan nama pasien wajib diisi ya");
      return;
    }
    const age = patientAge.trim() === "" ? null : parseInt(patientAge, 10);
    if (age !== null && (isNaN(age) || age < 1 || age > 120)) {
      setError("Umur pasien belum valid");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ caregiverName, city, patientName, patientAge: age });
      setEditing(false);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan, coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#8B5CF6] to-[#C4B5FD] text-white flex items-center justify-center font-extrabold text-xl flex-none ring-2 ring-purple-100 overflow-hidden">
            {(editing ? caregiverName : initialCaregiverName)?.charAt(0)?.toUpperCase() || "C"}
          </div>
          <div className="min-w-0">
            <h3 className="font-extrabold text-lg leading-tight truncate">
              {editing ? caregiverName.trim() || "…" : initialCaregiverName}
            </h3>
            <p className="text-xs text-soft font-medium">Caregiver</p>
          </div>
        </div>
        {!editing && (
          <button onClick={startEdit} className="btn-primary flex-none">
            Edit
          </button>
        )}
      </div>

      {saved && !editing && (
        <div className="text-sm font-bold text-green-deep bg-green-tint rounded-xl px-4 py-3 mb-5">
          Profil tersimpan.
        </div>
      )}
      {error && (
        <div className="text-sm text-red-deep bg-red-tint rounded-xl px-4 py-3 mb-5">{error}</div>
      )}

      {!editing ? (
        <dl className="divide-y divide-border/60">
          <div className="py-3.5 flex items-center justify-between gap-4">
            <dt className="text-xs font-bold text-soft uppercase tracking-wide">Nama caregiver</dt>
            <dd className="text-sm font-bold text-right">{initialCaregiverName}</dd>
          </div>
          <div className="py-3.5 flex items-center justify-between gap-4">
            <dt className="text-xs font-bold text-soft uppercase tracking-wide">Kota</dt>
            <dd className="text-sm font-semibold text-right">{initialCity || "—"}</dd>
          </div>
          <div className="py-3.5 flex items-center justify-between gap-4">
            <dt className="text-xs font-bold text-soft uppercase tracking-wide">Nama pasien</dt>
            <dd className="text-sm font-bold text-right">{initialPatientName}</dd>
          </div>
          <div className="py-3.5 flex items-center justify-between gap-4">
            <dt className="text-xs font-bold text-soft uppercase tracking-wide">Umur pasien</dt>
            <dd className="text-sm font-semibold text-right">
              {initialPatientAge ? `${initialPatientAge} tahun` : "—"}
            </dd>
          </div>
        </dl>
      ) : (
        <div>
          <label className={labelCls}>Nama caregiver</label>
          <input
            value={caregiverName}
            onChange={(e) => setCaregiverName(e.target.value)}
            placeholder="Nama kamu"
            maxLength={40}
            className={inputCls}
          />
          <label className={labelCls}>Kota domisili</label>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Kota"
            className={inputCls}
          />
          <label className={labelCls}>Nama pasien</label>
          <input
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="Nama pasien"
            maxLength={80}
            className={inputCls}
          />
          <label className={labelCls}>Umur pasien</label>
          <input
            type="number"
            min={1}
            max={120}
            value={patientAge}
            onChange={(e) => setPatientAge(e.target.value)}
            placeholder="Umur"
            className={inputCls}
          />
          <div className="flex items-center gap-3 mt-1">
            <button onClick={cancelEdit} className="text-sm font-bold text-soft hover:text-ink px-2">
              Batal
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 justify-center disabled:opacity-60">
              {saving ? "Menyimpan…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
