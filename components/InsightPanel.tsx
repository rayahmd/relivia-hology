"use client";

import { useState } from "react";
import type { AiInsight, ClinicalInsight } from "@/lib/types";
import { IconPill, IconMoon, IconUsers, IconEdit, IconSparkle, IconAlertTriangle } from "@/components/Icons";
import Link from "next/link";

const FACTOR_ICONS = [IconPill, IconMoon, IconUsers, IconEdit, IconPill];

export default function InsightPanel({
  patientName,
  latest,
  latestNew,
}: {
  patientName: string;
  latest: AiInsight | null;
  latestNew: ClinicalInsight | null;
}) {
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<AiInsight | null>(latest);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insight", { method: "POST" });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Terjadi kesalahan."); return; }
      setInsight(json.insight);
    } catch { setError("Gagal terhubung ke server."); }
    finally { setLoading(false); }
  }

  const badgeLabel =
    insight?.risk_category === "high" ? "Perlu Perhatian (Tinggi)"
    : insight?.risk_category === "medium" ? "Perlu Perhatian (Sedang)"
    : "Stabil";

  return (
    <>
      {/* ── Agent Insight (new) ────────────────────────────────── */}
      {latestNew && (
        <div className="card mb-6 overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-[#2D1B69] to-[#4338CA] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-white font-extrabold">Clinical Insight dari Agent</span>
            </div>
            <span className="text-white/60 text-xs">{new Date(latestNew.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</span>
          </div>
          <div className="p-6 space-y-5">
            {/* Detected Changes */}
            {latestNew.detected_changes?.length > 0 && (
              <section>
                <div className="text-[11px] font-bold uppercase tracking-wide text-primary mb-2">Perubahan Terdeteksi</div>
                <div className="grid gap-2">
                  {latestNew.detected_changes.map((c, i) => (
                    <div key={i} className="flex items-center justify-between bg-red-tint/50 rounded-xl px-4 py-3 text-sm">
                      <span className="font-medium capitalize">{String(c.metric).replace(/_/g, " ")}</span>
                      <span className="text-red-deep font-bold text-xs">
                        {c.current} → baseline {c.baseline}
                        {" "}({(c.change_percent ?? 0) > 0 ? "+" : ""}{c.change_percent}%)
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Interpretation */}
            {latestNew.interpretation && (
              <section>
                <div className="text-[11px] font-bold uppercase tracking-wide text-primary mb-2">Interpretasi</div>
                <div className="bg-primary-light rounded-xl px-4 py-4 text-sm leading-relaxed">{latestNew.interpretation}</div>
              </section>
            )}

            {/* Related Factors */}
            {latestNew.related_factors?.length > 0 && (
              <section>
                <div className="text-[11px] font-bold uppercase tracking-wide text-primary mb-2">Faktor Terkait</div>
                <ul className="space-y-1.5">
                  {latestNew.related_factors.map((f, i) => (
                    <li key={i} className="flex gap-2 text-sm"><span className="text-primary mt-0.5">•</span>{f}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* Monitoring */}
            {latestNew.monitoring_points?.length > 0 && (
              <section>
                <div className="text-[11px] font-bold uppercase tracking-wide text-primary mb-2">Yang Perlu Dipantau</div>
                <ul className="space-y-1.5">
                  {latestNew.monitoring_points.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm"><span className="text-amber-deep mt-0.5">→</span>{p}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* Caregiver context */}
            {latestNew.context_notes && (
              <section>
                <div className="text-[11px] font-bold uppercase tracking-wide text-primary mb-2">Konteks dari Caregiver</div>
                <p className="text-sm text-soft italic">"{latestNew.context_notes}"</p>
              </section>
            )}

            {/* Disclaimer */}
            <div className="bg-bg rounded-xl px-4 py-3.5 text-xs text-faint leading-relaxed">
              Ini bukan diagnosis dan bukan keputusan klinis. Diskusikan informasi ini dengan tenaga kesehatan yang menangani pasien.
            </div>

            <Link href="/summary" className="flex w-full justify-center text-center btn-primary py-3.5">
              Buat Consultation Brief
            </Link>
          </div>
        </div>
      )}

      {/* ── Generate from Check-in (legacy) ─────────────────────── */}
      <div className="rounded-3xl p-6 md:p-9 mb-6 text-white flex items-center justify-between gap-5 flex-wrap bg-gradient-to-br from-primary to-[#4E7FF0]">
        <div>
          <h3 className="text-xl font-extrabold mb-2">Insight dari Catatan Harian</h3>
          <p className="text-sm text-primary-tint max-w-[420px] leading-relaxed">
            Relivia merangkum pola dari catatan harian {patientName} — bukan diagnosis, bukan prediksi.
            Hanya pola yang layak dibicarakan bareng psikiater.
          </p>
        </div>
        <button onClick={generate} disabled={loading} className="w-full sm:w-auto justify-center bg-white text-primary-dark font-bold rounded-full px-6 py-3.5 hover:bg-[#F2F6FF] disabled:opacity-70 inline-flex items-center gap-2">
          {loading ? "Menganalisis…" : (<><>{insight ? "Buat ulang Insight" : "Buat Insight"}</> <IconSparkle size={15} /></>)}
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-3 mb-5 bg-primary-light rounded-2xl px-5 py-4">
          <div className="w-[18px] h-[18px] border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-semibold text-primary-dark">Meracik insight dari 14 hari catatan…</span>
        </div>
      )}

      {error && <div className="text-sm text-red-deep bg-red-tint rounded-xl px-4 py-3 mb-5">{error}</div>}

      {insight && !loading && (
        <div>
          <span className="inline-flex items-center gap-2 px-[18px] py-2.5 rounded-full font-extrabold text-sm mb-5 bg-amber-tint text-amber-deep">
            <IconAlertTriangle size={14} /> Kategori: {badgeLabel}
          </span>
          <div className="grid sm:grid-cols-2 gap-3.5 mb-5">
            {insight.contributing_factors.map((f, i) => {
              const Icon = FACTOR_ICONS[i % FACTOR_ICONS.length];
              return (
                <div key={i} className="card px-[18px] py-4 text-sm leading-relaxed flex gap-3">
                  <div className="w-[30px] h-[30px] rounded-lg bg-red-tint text-red-deep flex items-center justify-center flex-none">
                    <Icon size={16} />
                  </div>
                  <div>{f}</div>
                </div>
              );
            })}
          </div>
          <div className="bg-primary-light rounded-2xl px-[22px] py-5 text-sm leading-relaxed mb-4">
            <b className="text-primary-dark">Ringkasan untuk psikiater: </b>
            {insight.summary_text}
          </div>
          <div className="text-xs text-soft bg-bg rounded-xl px-4 py-3.5 leading-relaxed">
            Relivia menyusun ulang pengamatan caregiver menjadi rangkuman terstruktur. Ini bukan diagnosis
            maupun prediksi relaps — keputusan klinis tetap sepenuhnya di tangan psikiater yang menangani.
          </div>
        </div>
      )}
    </>
  );
}
