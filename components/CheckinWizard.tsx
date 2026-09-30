"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitCheckin } from "@/app/checkin/actions";
import { IconCheck } from "@/components/Icons";

function FaceCircle({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 40 40" className="w-8 h-8 mx-auto mb-1.5">
      <circle cx="20" cy="20" r="18" fill={bg} />
      {children}
    </svg>
  );
}

const MOOD_OPTIONS = [
  { v: 1, label: "Sangat murung", icon: <FaceCircle bg="#FDE7E1"><circle cx="14" cy="17" r="2" fill="#C1442B" /><circle cx="26" cy="17" r="2" fill="#C1442B" /><path d="M13 27q7-6 14 0" stroke="#C1442B" strokeWidth="2.5" fill="none" strokeLinecap="round" /></FaceCircle> },
  { v: 2, label: "Murung", icon: <FaceCircle bg="#FFF2DC"><circle cx="14" cy="17" r="2" fill="#9A6A0A" /><circle cx="26" cy="17" r="2" fill="#9A6A0A" /><path d="M14 26q6-3 12 0" stroke="#9A6A0A" strokeWidth="2.5" fill="none" strokeLinecap="round" /></FaceCircle> },
  { v: 3, label: "Biasa saja", icon: <FaceCircle bg="#F1F4FA"><circle cx="14" cy="17" r="2" fill="#67728A" /><circle cx="26" cy="17" r="2" fill="#67728A" /><line x1="14" y1="25" x2="26" y2="25" stroke="#67728A" strokeWidth="2.5" strokeLinecap="round" /></FaceCircle> },
  { v: 4, label: "Ceria", icon: <FaceCircle bg="#DCE9FF"><circle cx="14" cy="17" r="2" fill="#1F52B8" /><circle cx="26" cy="17" r="2" fill="#1F52B8" /><path d="M14 24q6 5 12 0" stroke="#1F52B8" strokeWidth="2.5" fill="none" strokeLinecap="round" /></FaceCircle> },
  { v: 5, label: "Ceria & stabil", icon: <FaceCircle bg="#DEF6EE"><circle cx="14" cy="17" r="2" fill="#1B7A5C" /><circle cx="26" cy="17" r="2" fill="#1B7A5C" /><path d="M13 23q7 7 14 0" stroke="#1B7A5C" strokeWidth="2.5" fill="none" strokeLinecap="round" /></FaceCircle> },
];
const SLEEP_OPTIONS = [
  { v: 1, label: "Sangat terganggu", icon: <FaceCircle bg="#FDE7E1"><path d="M14 24c2-6 10-6 12 0" stroke="#C1442B" strokeWidth="2.5" fill="none" strokeLinecap="round" /></FaceCircle> },
  { v: 2, label: "Terganggu", icon: <FaceCircle bg="#FFF2DC"><path d="M14 23c2-4 10-4 12 0" stroke="#9A6A0A" strokeWidth="2.5" fill="none" strokeLinecap="round" /></FaceCircle> },
  { v: 3, label: "Cukup", icon: <FaceCircle bg="#F1F4FA"><line x1="14" y1="22" x2="26" y2="22" stroke="#67728A" strokeWidth="2.5" strokeLinecap="round" /></FaceCircle> },
  { v: 4, label: "Nyenyak", icon: <FaceCircle bg="#DCE9FF"><path d="M14 21q6 4 12 0" stroke="#1F52B8" strokeWidth="2.5" fill="none" strokeLinecap="round" /></FaceCircle> },
  { v: 5, label: "Sangat nyenyak", icon: <FaceCircle bg="#DEF6EE"><path d="M13 20q7 6 14 0" stroke="#1B7A5C" strokeWidth="2.5" fill="none" strokeLinecap="round" /></FaceCircle> },
];
const SOCIAL_OPTIONS = [
  { v: 1, label: "Menarik diri", icon: <FaceCircle bg="#FDE7E1"><rect x="12" y="11" width="10" height="18" rx="1.5" fill="none" stroke="#C1442B" strokeWidth="2" /><circle cx="18.5" cy="20" r="0.9" fill="#C1442B" /></FaceCircle> },
  { v: 2, label: "Kurang aktif", icon: <FaceCircle bg="#FFF2DC"><circle cx="14" cy="17" r="2" fill="#9A6A0A" /><circle cx="26" cy="17" r="2" fill="#9A6A0A" /><line x1="15" y1="26" x2="25" y2="26" stroke="#9A6A0A" strokeWidth="2.5" strokeLinecap="round" /></FaceCircle> },
  { v: 3, label: "Biasa saja", icon: <FaceCircle bg="#F1F4FA"><circle cx="14" cy="17" r="2" fill="#67728A" /><circle cx="26" cy="17" r="2" fill="#67728A" /><line x1="14" y1="25" x2="26" y2="25" stroke="#67728A" strokeWidth="2.5" strokeLinecap="round" /></FaceCircle> },
  { v: 4, label: "Aktif", icon: <FaceCircle bg="#DCE9FF"><path d="M11 20a9 9 0 1114.2 7.3L26 30l-3.4-1.3A9 9 0 0111 20z" fill="none" stroke="#1F52B8" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></FaceCircle> },
  { v: 5, label: "Sangat terbuka", icon: <FaceCircle bg="#DEF6EE"><path d="M20 27s-6.2-3.7-8.1-7.5A4.4 4.4 0 0120 15.7a4.4 4.4 0 018.1 3.8C26.2 23.3 20 27 20 27z" fill="none" stroke="#1B7A5C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></FaceCircle> },
];

export default function CheckinWizard({ patientName }: { patientName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    mood: 0,
    sleep_quality: 0,
    social_interaction: 0,
    medication_taken: null as boolean | null,
    appetite: "" as "decreased" | "normal" | "increased" | "",
    self_care: "" as "decreased" | "normal" | "improved" | "",
    behavior_change: false,
    free_text_note: "",
  });

  const totalSteps = 7;

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await submitCheckin({
        mood: form.mood,
        sleep_quality: form.sleep_quality,
        social_interaction: form.social_interaction,
        medication_taken: form.medication_taken ?? true,
        appetite: (form.appetite || "normal") as "decreased" | "normal" | "increased",
        self_care: (form.self_care || "normal") as "decreased" | "normal" | "improved",
        behavior_change: form.behavior_change,
        free_text_note: form.free_text_note,
      });
      setSuccess(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="max-w-[600px] mx-auto text-center py-16">
        <div className="w-[74px] h-[74px] rounded-full bg-green-tint text-green flex items-center justify-center mx-auto mb-5">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M4 12l5 5L20 6" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3 className="text-xl font-extrabold mb-2">Catatan hari ini tersimpan!</h3>
        <p className="text-soft text-sm mb-6">Makasih, catatan untuk {patientName} sudah rapi tercatat.</p>
        <button onClick={() => router.push("/dashboard")} className="btn-primary">
          Lihat dasbor
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[600px] mx-auto">
      <div className="flex gap-1.5 mb-8">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div key={i} className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
            <div className={`h-full bg-primary transition-all ${i <= step ? "w-full" : "w-0"}`} />
          </div>
        ))}
      </div>

      {/* mood */}
      {step === 0 && (
        <Step eyebrow="LANGKAH 1 DARI 7" title={`Gimana suasana hati ${patientName} hari ini?`} hint="Lihat secara umum ya, nggak perlu detail banget.">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-2.5">
            {MOOD_OPTIONS.map((o) => (
              <button key={o.v} onClick={() => { setForm({ ...form, mood: o.v }); setStep(1); }} className={`opt-card ${form.mood === o.v ? "selected" : ""}`}>
                {o.icon}
                <span className="text-[11px] sm:text-xs font-semibold text-soft">{o.label}</span>
              </button>
            ))}
          </div>
        </Step>
      )}

      {/* sleep */}
      {step === 1 && (
        <Step eyebrow="LANGKAH 2 DARI 7" title="Semalam tidurnya gimana?" hint="Perkiraan aja, nggak perlu catat jam pastinya." onBack={() => setStep(0)}>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-2.5">
            {SLEEP_OPTIONS.map((o) => (
              <button key={o.v} onClick={() => { setForm({ ...form, sleep_quality: o.v }); setStep(2); }} className={`opt-card ${form.sleep_quality === o.v ? "selected" : ""}`}>
                {o.icon}
                <span className="text-[11px] sm:text-xs font-semibold text-soft">{o.label}</span>
              </button>
            ))}
          </div>
        </Step>
      )}

      {/* social */}
      {step === 2 && (
        <Step eyebrow="LANGKAH 3 DARI 7" title="Gimana interaksi sosialnya?" hint="Ngobrol, keluar kamar, respons ke keluarga." onBack={() => setStep(1)}>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-2.5">
            {SOCIAL_OPTIONS.map((o) => (
              <button key={o.v} onClick={() => { setForm({ ...form, social_interaction: o.v }); setStep(3); }} className={`opt-card ${form.social_interaction === o.v ? "selected" : ""}`}>
                {o.icon}
                <span className="text-[11px] sm:text-xs font-semibold text-soft">{o.label}</span>
              </button>
            ))}
          </div>
        </Step>
      )}

      {/* medication */}
      {step === 3 && (
        <Step eyebrow="LANGKAH 4 DARI 7" title="Obat hari ini gimana?" onBack={() => setStep(2)}>
          <div className="flex flex-col gap-3">
            {[
              { label: "Diminum sesuai jadwal", val: true, color: "green" },
              { label: "Terlewat / ditolak", val: false, color: "red" },
            ].map((o) => (
              <button
                key={String(o.val)}
                onClick={() => { setForm({ ...form, medication_taken: o.val }); setStep(4); }}
                className={`py-5 rounded-2xl border-2 font-bold text-sm transition ${
                  form.medication_taken === o.val
                    ? o.color === "green" ? "border-green bg-green-tint text-green-deep" : "border-red bg-red-tint text-red-deep"
                    : "border-border hover:border-primary/40"
                }`}
              >
                {o.label}
              </button>
            ))}
            <button
              onClick={() => { setForm({ ...form, medication_taken: true }); setStep(4); }}
              className="py-3.5 rounded-2xl border-2 border-dashed border-border font-semibold text-sm text-soft hover:border-primary/40 transition"
            >
              Tidak tahu / tidak bisa memastikan
            </button>
          </div>
        </Step>
      )}

      {/* appetite */}
      {step === 4 && (
        <Step eyebrow="LANGKAH 5 DARI 7" title="Bagaimana nafsu makannya?" onBack={() => setStep(3)}>
          <div className="flex flex-col gap-3">
            {[
              { v: "decreased", label: "Berkurang dari biasanya" },
              { v: "normal", label: "Normal seperti biasa" },
              { v: "increased", label: "Bertambah dari biasanya" },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => { setForm({ ...form, appetite: o.v as "decreased" | "normal" | "increased" }); setStep(5); }}
                className={`py-5 rounded-2xl border-2 font-bold text-sm transition ${
                  form.appetite === o.v ? "border-primary bg-primary-light text-primary-dark" : "border-border hover:border-primary/40"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Step>
      )}

      {/* self-care */}
      {step === 5 && (
        <Step eyebrow="LANGKAH 6 DARI 7" title="Bagaimana kebersihan & perawatan diri?" hint="Mandi, ganti baju, kebersihan umum." onBack={() => setStep(4)}>
          <div className="flex flex-col gap-3">
            {[
              { v: "decreased", label: "Menurun, kurang merawat diri" },
              { v: "normal", label: "Normal seperti biasa" },
              { v: "improved", label: "Lebih baik dari biasanya" },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => { setForm({ ...form, self_care: o.v as "decreased" | "normal" | "improved" }); setStep(6); }}
                className={`py-5 rounded-2xl border-2 font-bold text-sm transition ${
                  form.self_care === o.v ? "border-primary bg-primary-light text-primary-dark" : "border-border hover:border-primary/40"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Step>
      )}

      {/* notes + behavior change */}
      {step === 6 && (
        <Step eyebrow="LANGKAH 7 DARI 7" title="Ada yang ingin dicatat?" hint="Opsional — kata-kata, kebiasaan yang berubah, apa saja." onBack={() => setStep(5)}>
          <div className="mb-4">
            <label className="flex items-center gap-3 p-4 rounded-2xl border-2 border-border cursor-pointer hover:border-primary/40 transition select-none">
              <input
                type="checkbox"
                checked={form.behavior_change}
                onChange={(e) => setForm({ ...form, behavior_change: e.target.checked })}
                className="w-5 h-5 rounded accent-primary cursor-pointer"
              />
              <span className="text-sm font-semibold">Ada perubahan perilaku yang menonjol hari ini</span>
            </label>
          </div>
          <textarea
            value={form.free_text_note}
            onChange={(e) => setForm({ ...form, free_text_note: e.target.value })}
            placeholder={`Contoh: lebih banyak diam di kamar sore ini, sempat bilang "capek mikirin semuanya".`}
            className="w-full text-sm p-4 rounded-2xl border-2 border-border min-h-[110px] focus:outline-none focus:border-primary text-left"
          />
          <div className="flex items-center justify-center gap-3.5 mt-7">
            <button onClick={() => setStep(5)} className="text-soft hover:text-ink font-semibold text-sm px-2.5 py-3.5">Kembali</button>
            <button onClick={handleSubmit} disabled={submitting} className="btn-primary disabled:opacity-60">
              {submitting ? "Menyimpan…" : (<>Simpan catatan hari ini <IconCheck size={15} /></>)}
            </button>
          </div>
        </Step>
      )}
    </div>
  );
}

function Step({
  eyebrow, title, hint, onBack, children,
}: { eyebrow: string; title: string; hint?: string; onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="text-center">
      <div className="text-xs font-bold text-primary mb-2.5">{eyebrow}</div>
      <h3 className="text-2xl font-extrabold mb-2 tracking-tight">{title}</h3>
      {hint && <p className="text-sm text-soft mb-7">{hint}</p>}
      {children}
      {onBack && (
        <div className="mt-6">
          <button onClick={onBack} className="text-soft hover:text-ink font-semibold text-sm">Kembali</button>
        </div>
      )}
    </div>
  );
}
