"use client";

import { useState, useMemo } from "react";
import type { DailyCheckin, AiInsight, ClinicalInsight, ConsultationBrief } from "@/lib/types";

const PERIODS = [
  { days: 7, label: "1 minggu" },
  { days: 21, label: "3 minggu" },
  { days: 30, label: "1 bulan" },
];

export default function SummaryClient({
  checkins,
  insight,
  agentInsight,
  consultationBrief,
  patientName,
  patientId,
}: {
  checkins: DailyCheckin[];
  insight: AiInsight | null;
  agentInsight: ClinicalInsight | null;
  consultationBrief: ConsultationBrief | null;
  patientName: string;
  patientId: string;
}) {
  const [periodDays, setPeriodDays] = useState(7);
  const [generating, setGenerating] = useState(false);
  const [brief, setBrief] = useState<ConsultationBrief | null>(consultationBrief);
  const [error, setError] = useState<string | null>(null);

  const slice = useMemo(() => checkins.slice(-Math.min(periodDays, checkins.length)), [checkins, periodDays]);

  const adherence = slice.length
    ? Math.round((slice.filter((c) => c.medication_taken).length / slice.length) * 100)
    : 0;

  const periodLabel = PERIODS.find((p) => p.days === periodDays)?.label ?? "";
  const rangeLabel = slice.length ? `${slice[0].checkin_date} – ${slice[slice.length - 1].checkin_date}` : "-";
  const riskLabel = insight?.risk_category === "high" ? "Tinggi" : insight?.risk_category === "medium" ? "Sedang" : insight ? "Rendah" : "-";

  async function generateBrief() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/consultation/${patientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insight_id: agentInsight?.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Gagal membuat brief");
      setBrief(json.brief);
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownloadPdf() {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const marginX = 48;
    let y = 60;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Ringkasan Konsultasi", marginX, y);
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text("RELIVIA - CATATAN CAREGIVER TERSTRUKTUR", marginX, y);
    doc.setTextColor(0);
    y += 30;

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`Pasien: ${patientName}`, marginX, y); y += 16;
    doc.text(`Periode: ${rangeLabel} (${periodLabel})`, marginX, y); y += 16;
    doc.text(`Kepatuhan obat periode ini: ${adherence}%`, marginX, y); y += 16;
    if (!agentInsight) {
      doc.text(`Kategori perhatian: ${riskLabel}`, marginX, y); y += 28;
    }

    function section(title: string, body: string) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(title, marginX, y);
      y += 16;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      const lines = doc.splitTextToSize(body, 500);
      doc.text(lines, marginX, y);
      y += lines.length * 14 + 18;
    }

    // Prefer agent brief content
    if (brief?.full_content) {
      section("Consultation Brief (AI Agent)", brief.full_content);
    }
    if (brief?.key_changes?.length) {
      section("Perubahan Utama", brief.key_changes.map((c, i) => `${i + 1}. ${c}`).join("\n"));
    }
    if (brief?.caregiver_observation) {
      section("Observasi Caregiver", brief.caregiver_observation);
    }
    if (brief?.questions_for_consultation?.length) {
      section("Poin untuk Konsultasi", brief.questions_for_consultation.map((q, i) => `${i + 1}. ${q}`).join("\n"));
    }
    if (agentInsight?.interpretation) {
      section("Interpretasi", agentInsight.interpretation);
    }
    if (!brief && insight) {
      section("Faktor yang teramati", insight.contributing_factors?.length
        ? insight.contributing_factors.map((f, i) => `${i + 1}. ${f}`).join("\n")
        : "Belum ada insight yang dibuat untuk periode ini."
      );
      section("Ringkasan klinis", insight.summary_text ?? "-");
    }

    doc.setFontSize(8.5);
    doc.setTextColor(140);
    doc.text(
      "Disusun otomatis oleh Relivia. Bukan alat diagnosis — dokumen ini bahan diskusi, keputusan klinis sepenuhnya di tangan psikiater.",
      marginX, 780, { maxWidth: 500 }
    );
    doc.save(`ringkasan-konsultasi-${patientName.toLowerCase().replace(/\s+/g, "-")}.pdf`);
  }

  return (
    <div className="max-w-[560px]">
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => setPeriodDays(p.days)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-bold transition ${
                periodDays === p.days
                  ? "bg-primary text-white shadow-pop"
                  : "text-soft hover:text-ink"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleDownloadPdf}
          className="w-fit rounded-full bg-[#D93A2B] hover:bg-[#C1442B] active:scale-[0.98] transition text-white text-sm font-bold px-5 py-2.5 shadow-[0_6px_16px_-6px_rgba(217,58,43,0.6)]"
        >
          Unduh PDF
        </button>
      </div>

      {/* Generate Agent Brief */}
      {agentInsight && !brief && (
        <div className="bg-[#FFF7D6] rounded-[18px] p-5 mb-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="font-bold mb-0.5 text-[14px] text-ink">Buat Consultation Brief dari Agent Insight</div>
            <div className="text-[13px] text-soft">Gemini akan menyusun dokumen terstruktur siap pakai saat konsultasi.</div>
          </div>
          <button onClick={generateBrief} disabled={generating} className="rounded-full bg-[#D93A2B] hover:bg-[#C1442B] text-white text-sm font-bold px-5 py-2.5 disabled:opacity-60 flex-none transition">
            {generating ? "Membuat…" : "Buat Brief"}
          </button>
        </div>
      )}
      {error && <div className="text-sm text-red-deep bg-red-tint rounded-xl px-4 py-3 mb-5">{error}</div>}

      {/* Consultation Brief (Agent) */}
      {brief && (
        <div className="bg-[#FFF7D6] rounded-[18px] p-5 md:p-6 mb-5">
          <div className="mb-1">
            <h3 className="text-[17px] font-extrabold text-ink leading-tight">Consultation Brief</h3>
            <div className="text-[11px] font-bold uppercase tracking-wide text-soft/80 mt-0.5">Relivia Agent · Disusun otomatis</div>
          </div>
          <div className="text-[12px] text-soft leading-relaxed mt-2">
            Periode: {brief.observation_period_start ?? "-"} – {brief.observation_period_end ?? "-"}<br />
            Dicetak: {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
          </div>
          <div className="h-px bg-ink/10 my-4" />

          <div className="grid grid-cols-2 gap-2.5 mb-4">
            <div className="bg-white rounded-[14px] px-4 py-3 shadow-sm">
              <div className="text-[12px] text-soft">Pasien</div>
              <div className="text-[15px] font-extrabold text-ink leading-snug">{patientName}</div>
            </div>
            <div className="bg-white rounded-[14px] px-4 py-3 shadow-sm">
              <div className="text-[12px] text-soft">Kepatuhan Obat</div>
              <div className="text-[15px] font-extrabold text-ink leading-snug">{brief.medication_status ?? `${adherence}%`}</div>
            </div>
          </div>

          {brief.key_changes?.length > 0 && (
            <div className="mb-5">
              <h4 className="text-[11px] uppercase tracking-wide text-primary font-extrabold mb-2">Perubahan Utama</h4>
              <ul className="space-y-1.5">
                {brief.key_changes.map((c, i) => (
                  <li key={i} className="flex gap-2 text-sm text-ink"><span className="text-red-deep">•</span>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {Object.keys(brief.baseline_comparison ?? {}).length > 0 && (
            <div className="mb-5">
              <h4 className="text-[11px] uppercase tracking-wide text-primary font-extrabold mb-2">Perbandingan Baseline</h4>
              <div className="grid gap-2">
                {Object.entries(brief.baseline_comparison).map(([metric, v]) => (
                  <div key={metric} className="flex items-center justify-between bg-white rounded-[14px] px-4 py-3 text-sm shadow-sm">
                    <span className="font-medium capitalize text-ink">{metric.replace(/_/g, " ")}</span>
                    <span className="font-bold text-primary">{v.baseline} → {v.current}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {brief.caregiver_observation && (
            <div className="mb-5">
              <h4 className="text-[11px] uppercase tracking-wide text-primary font-extrabold mb-2">Observasi Caregiver</h4>
              <p className="text-sm leading-relaxed text-ink">{brief.caregiver_observation}</p>
            </div>
          )}

          {brief.full_content && (
            <div className="mb-5">
              <h4 className="text-[11px] uppercase tracking-wide text-primary font-extrabold mb-2">Ringkasan Lengkap</h4>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink">{brief.full_content}</p>
            </div>
          )}

          {brief.questions_for_consultation?.length > 0 && (
            <div className="mb-2">
              <h4 className="text-[11px] uppercase tracking-wide text-primary font-extrabold mb-2">Poin untuk Konsultasi</h4>
              <ul className="space-y-1.5">
                {brief.questions_for_consultation.map((q, i) => (
                  <li key={i} className="flex gap-2 text-sm text-ink"><span className="text-primary font-bold">{i + 1}.</span>{q}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 text-[11px] text-soft/80 leading-relaxed">
            Disusun otomatis oleh Relivia dari observasi caregiver. Bukan alat diagnosis — dokumen ini bahan diskusi, keputusan klinis sepenuhnya di tangan psikiater.
          </div>
        </div>
      )}

      {/* Legacy Summary */}
      <div className="bg-[#FFF7D6] rounded-[18px] p-5 md:p-6">
        <div className="mb-1">
          <h3 className="text-[17px] font-extrabold text-ink leading-tight">Ringkasan Catatan Harian</h3>
          <div className="text-[11px] font-bold uppercase tracking-wide text-soft/80 mt-0.5">Relivia · Catatan Caregiver Terstruktur</div>
        </div>
        <div className="text-[12px] text-soft leading-relaxed mt-2">
          Periode: {rangeLabel} ({periodLabel})<br />
          Dicetak: {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
        </div>
        <div className="h-px bg-ink/10 my-4" />

        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <div className="bg-white rounded-[14px] px-4 py-3 shadow-sm">
            <div className="text-[12px] text-soft">Pasien</div>
            <div className="text-[15px] font-extrabold text-ink leading-snug">{patientName}</div>
          </div>
          <div className="bg-white rounded-[14px] px-4 py-3 shadow-sm">
            <div className="text-[12px] text-soft leading-snug">Kepatuhan obat periode ini</div>
            <div className="text-[15px] font-extrabold text-ink leading-snug">{adherence}%</div>
          </div>
          {insight && (
            <div className="bg-white rounded-[14px] px-4 py-3 shadow-sm col-span-2">
              <div className="text-[12px] text-soft">Kategori perhatian</div>
              <div className="text-[15px] font-extrabold text-amber-deep">{riskLabel}</div>
            </div>
          )}
        </div>

        {insight ? (
          <>
            <div className="mb-5">
              <h4 className="text-[11px] uppercase tracking-wide text-primary font-extrabold mb-2">Ringkasan klinis</h4>
              <p className="text-sm leading-relaxed text-ink">{insight.summary_text}</p>
            </div>
            <div className="mb-2">
              <h4 className="text-[11px] uppercase tracking-wide text-primary font-extrabold mb-2">Faktor yang teramati</h4>
              <ul className="space-y-1.5">
                {insight.contributing_factors.map((f, i) => (
                  <li key={i} className="flex gap-2 text-sm text-ink"><span className="text-primary">•</span>{f}</li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p className="text-[13px] leading-relaxed text-soft">Belum ada insight yang dibuat. Buat dulu di halaman Insight Klinis.</p>
        )}

        <div className="mt-4 text-[11px] text-soft/80 leading-relaxed">
          Disusun otomatis oleh Relivia dari catatan caregiver periode terpilih. Bukan alat diagnosis - dokumen ini bahan diskusi, keputusan klinis sepenuhnya di tangan psikiater.
        </div>
      </div>
    </div>
  );
}
