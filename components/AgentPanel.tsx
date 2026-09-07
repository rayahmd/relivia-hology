"use client";

import { useState, useEffect, useCallback } from "react";
import type { ClinicalInsight } from "@/lib/types";

type AgentStatus =
  | "idle"
  | "loading_session"
  | "investigating"
  | "waiting_for_caregiver"
  | "reanalyzing"
  | "completed"
  | "no_change"
  | "error";

type ChangeResult = {
  metric: string;
  label: string;
  baseline_value: number;
  current_value: number;
  change_percent: number;
  severity: string;
  direction: "up" | "down" | "stable";
};

type SessionPayload = {
  id: string;
  status: string;
  questions_count: number;
  max_questions: number;
  last_question: string | null;
  changes: ChangeResult[];
};

/**
 * AgentPanel — automatic-first (PRD §26–§27, §37).
 *
 * - Opened via notification deep link (?session=) or directly: the panel
 *   resumes the matching / latest active session automatically.
 * - NO "Mulai Investigasi" button in the automatic flow (PRD §39).
 * - The manual button only appears in idle state (no active session),
 *   kept for demo/debug of the manual path.
 */
export default function AgentPanel({
  patientId,
  patientName,
  initialSessionId,
}: {
  patientId: string;
  patientName: string;
  initialSessionId?: string | null;
}) {
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [changes, setChanges] = useState<ChangeResult[]>([]);
  const [insight, setInsight] = useState<ClinicalInsight | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [questionsCount, setQuestionsCount] = useState(0);

  const loadSession = useCallback(async (id: string) => {
    setStatus("loading_session");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/agent/session/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sesi tidak ditemukan");

      const s: SessionPayload = json.session;
      setSessionId(s.id);
      setChanges(s.changes ?? []);
      setQuestionsCount(s.questions_count ?? 0);

      if (s.status === "waiting_for_caregiver" && s.last_question) {
        setQuestion(s.last_question);
        setStatus("waiting_for_caregiver");
      } else if (s.status === "completed" && json.insight) {
        setInsight(json.insight);
        setStatus("completed");
      } else {
        // Still investigating (e.g. agent retry after Gemini outage) — poll state.
        setStatus("investigating");
      }
    } catch (e) {
      setErrorMsg(String(e instanceof Error ? e.message : e));
      setStatus("error");
    }
  }, []);

  // Auto-resume: deep-link session first, else latest pending notification (PRD §26).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (initialSessionId) {
        await loadSession(initialSessionId);
        return;
      }
      try {
        const res = await fetch("/api/notifications/dispatch", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const first = json.notifications?.[0];
        if (first && !cancelled) {
          await loadSession(first.sessionId);
        }
      } catch {
        /* offline — stay idle */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialSessionId, loadSession]);

  async function startInvestigation() {
    setStatus("investigating");
    setErrorMsg(null);
    setInsight(null);
    setBrief(null);
    setChanges([]);
    setQuestion(null);
    setSessionId(null);
    setQuestionsCount(0);

    try {
      const res = await fetch("/api/agent/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId }),
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error ?? "Investigasi gagal");

      setChanges(json.changes ?? []);

      if (json.status === "no_change") {
        setStatus("no_change");
        return;
      }

      if (json.status === "waiting_for_caregiver") {
        setSessionId(json.session_id);
        setQuestion(json.question);
        setQuestionsCount(1);
        setStatus("waiting_for_caregiver");
        return;
      }

      if (json.status === "completed") {
        setSessionId(json.session_id);
        setInsight(json.insight);
        setStatus("completed");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function submitAnswer(ans: string) {
    if (!sessionId) return;
    setStatus("reanalyzing");
    setAnswer("");

    try {
      const res = await fetch("/api/agent/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, answer: ans }),
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error ?? "Re-analisis gagal");

      if (json.status === "waiting_for_caregiver") {
        setQuestion(json.question);
        setQuestionsCount((c) => c + 1);
        setStatus("waiting_for_caregiver");
        return;
      }

      if (json.status === "completed") {
        setInsight(json.insight);
        setStatus("completed");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function generateBrief() {
    setGeneratingBrief(true);
    try {
      const res = await fetch(`/api/consultation/${patientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insight_id: insight?.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Gagal membuat brief");
      setBrief(json.brief?.full_content ?? null);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingBrief(false);
    }
  }

  const QUICK_REPLIES = [
    "Ya, lebih sering dari biasanya",
    "Tidak, masih normal",
    "Tidak terlalu yakin",
  ];

  return (
    <div className="max-w-[720px] mx-auto">
      {/* ── Header ─────────────────────────────────── */}
      <div className="rounded-3xl p-6 md:p-8 mb-6 bg-gradient-to-br from-[#2D1B69] to-[#4338CA] text-white">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M9.663 17h4.673M12 3v1M6.34 6.34l-.707-.707M3 12H2m4.34 5.66-.707.707M12 21v-1m5.66-2.34.707.707M21 12h1m-4.34-5.66.707-.707" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div className="font-extrabold text-lg leading-tight">Relivia Agent</div>
            <div className="text-white/60 text-xs">AI investigasi perubahan kondisi pasien</div>
          </div>
        </div>
        <p className="text-white/80 text-sm leading-relaxed">
          Relivia menganalisis data kesehatan dan catatan harian {patientName}, membandingkan dengan pola normal pribadinya,
          dan bertanya jika perlu konteks tambahan.
        </p>
      </div>

      {/* ── Status: Idle (no active session) ───────── */}
      {status === "idle" && (
        <div className="card p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3B5FDB" strokeWidth={1.8}>
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" strokeLinecap="round"/>
            </svg>
          </div>
          <h3 className="font-extrabold text-xl mb-2">Belum Ada Investigasi Aktif</h3>
          <p className="text-soft text-sm mb-6 max-w-[380px] mx-auto leading-relaxed">
            Monitoring berjalan otomatis di background. Jika terdeteksi perubahan bermakna dari pola biasanya {patientName},
            kamu akan menerima notifikasi — cukup tap notifikasinya.
          </p>
          <button onClick={startInvestigation} className="btn-primary">
            Mulai Investigasi Manual
          </button>
        </div>
      )}

      {/* ── Status: Loading session / Investigating ── */}
      {(status === "loading_session" || status === "investigating") && (
        <div className="card p-10 text-center">
          <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-5">
            <div className="w-8 h-8 border-[3px] border-primary border-t-transparent rounded-full animate-spin" />
          </div>
          <h3 className="font-extrabold text-xl mb-2">
            {status === "loading_session" ? "Membuka sesi investigasi…" : "Relivia sedang menganalisis…"}
          </h3>
          <p className="text-soft text-sm">Memeriksa data terbaru dan membandingkan dengan baseline personal {patientName}.</p>
          <div className="mt-6 flex flex-col gap-2 text-left max-w-[340px] mx-auto">
            {["Membaca data health & catatan harian", "Memuat baseline personal pasien", "Mendeteksi perubahan bermakna", "Melakukan reasoning…"].map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-soft">
                <div className="w-5 h-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin flex-none" style={{ animationDelay: `${i * 0.2}s` }} />
                {s}
              </div>
            ))}
          </div>
          {status === "investigating" && sessionId && (
            <button onClick={() => loadSession(sessionId)} className="mt-6 text-sm text-soft hover:text-ink font-semibold">
              Muat ulang status
            </button>
          )}
        </div>
      )}

      {/* ── Status: No Change ──────────────────────── */}
      {status === "no_change" && (
        <div className="card p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-green-tint flex items-center justify-center mx-auto mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1B7A5C" strokeWidth={2.2}>
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h3 className="font-extrabold text-xl mb-2 text-green-deep">Tidak Ada Perubahan Bermakna</h3>
          <p className="text-soft text-sm mb-6 max-w-[380px] mx-auto leading-relaxed">
            Data hari ini masih dalam rentang pola normal personal {patientName}. Terus lakukan pencatatan harian untuk memperkuat baseline.
          </p>
          {changes.length > 0 && (
            <div className="grid gap-2 mb-6 text-left">
              {changes.map((c) => (
                <div key={c.metric} className="flex items-center justify-between bg-bg rounded-xl px-4 py-3 text-sm">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-faint text-xs">{c.current_value} vs baseline {c.baseline_value}</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setStatus("idle")} className="text-sm text-soft hover:text-ink font-semibold">Kembali</button>
        </div>
      )}

      {/* ── Detected Changes ───────────────────────── */}
      {(status === "waiting_for_caregiver" || status === "completed" || status === "reanalyzing") && changes.length > 0 && (
        <div className="card p-5 mb-4">
          <div className="text-xs font-bold text-primary uppercase tracking-wide mb-3">Perubahan Terdeteksi</div>
          <div className="grid gap-2">
            {changes.filter(c => c.severity !== "normal").map((c) => (
              <div key={c.metric} className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm ${
                c.severity === "significant_change" ? "bg-red-tint" : "bg-amber-tint"
              }`}>
                <span className="font-semibold">{c.label}</span>
                <div className="text-right">
                  <div className="font-bold">{c.current_value} <span className="text-xs font-normal">(baseline: {c.baseline_value})</span></div>
                  <div className={`text-xs font-bold ${c.direction === "down" ? "text-red-deep" : "text-amber-deep"}`}>
                    {c.direction === "down" ? "▼" : "▲"} {Math.abs(c.change_percent)}% dari baseline
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Status: Waiting For Caregiver (PRD §26) ─ */}
      {status === "waiting_for_caregiver" && question && (
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-none">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="text-xs font-bold text-primary uppercase tracking-wide">
              Relivia perlu konteks tambahan {questionsCount > 1 ? `(pertanyaan ${questionsCount}/3)` : ""}
            </div>
          </div>
          <div className="bg-primary-light rounded-2xl p-5 mb-5">
            <p className="text-base font-semibold leading-relaxed">&quot;{question}&quot;</p>
          </div>
          <div className="flex flex-col gap-2 mb-4">
            {QUICK_REPLIES.map((r) => (
              <button
                key={r}
                onClick={() => submitAnswer(r)}
                className="text-left px-4 py-3.5 rounded-xl border-2 border-border font-semibold text-sm hover:border-primary hover:bg-primary-light transition"
              >
                {r}
              </button>
            ))}
          </div>
          <div className="relative">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Atau ketik jawabanmu sendiri…"
              className="w-full text-sm p-4 pr-[90px] rounded-2xl border-2 border-border min-h-[90px] focus:outline-none focus:border-primary resize-none"
            />
            <button
              onClick={() => answer.trim() && submitAnswer(answer.trim())}
              disabled={!answer.trim()}
              className="absolute bottom-3 right-3 px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-40 transition hover:bg-primary-dark"
            >
              Kirim
            </button>
          </div>
        </div>
      )}

      {/* ── Status: Re-analyzing ───────────────────── */}
      {status === "reanalyzing" && (
        <div className="card p-10 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-tint flex items-center justify-center mx-auto mb-5">
            <div className="w-8 h-8 border-[3px] border-amber border-t-transparent rounded-full animate-spin" />
          </div>
          <h3 className="font-extrabold text-xl mb-2">Relivia memperbarui analisis…</h3>
          <p className="text-soft text-sm">Menggabungkan konteks barumu ke dalam reasoning.</p>
        </div>
      )}

      {/* ── Status: Completed — Clinical Insight ───── */}
      {status === "completed" && insight && (
        <div className="space-y-4">
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-full bg-green-tint flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1B7A5C" strokeWidth={2.2}>
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span className="font-extrabold text-green-deep">Clinical Insight Siap</span>
            </div>

            {/* Detected Changes */}
            {insight.detected_changes && insight.detected_changes.length > 0 && (
              <section className="mb-5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-primary mb-2">Perubahan Terdeteksi</div>
                <div className="grid gap-2">
                  {insight.detected_changes.map((c, i) => (
                    <div key={i} className="flex items-center justify-between bg-red-tint/50 rounded-xl px-4 py-3 text-sm">
                      <span className="font-medium capitalize">{c.metric.replace(/_/g, " ")}</span>
                      <span className="text-red-deep font-bold text-xs">
                        {c.current} → baseline {c.baseline} ({c.change_percent > 0 ? "+" : ""}{c.change_percent}%)
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Interpretation */}
            {insight.interpretation && (
              <section className="mb-5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-primary mb-2">Interpretasi</div>
                <div className="bg-primary-light rounded-xl px-4 py-4 text-sm leading-relaxed">{insight.interpretation}</div>
              </section>
            )}

            {/* Related Factors */}
            {insight.related_factors && insight.related_factors.length > 0 && (
              <section className="mb-5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-primary mb-2">Faktor Terkait</div>
                <ul className="space-y-1.5">
                  {insight.related_factors.map((f, i) => (
                    <li key={i} className="flex gap-2 text-sm"><span className="text-primary mt-0.5">•</span>{f}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* Monitoring Points */}
            {insight.monitoring_points && insight.monitoring_points.length > 0 && (
              <section className="mb-5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-primary mb-2">Yang Perlu Dipantau</div>
                <ul className="space-y-1.5">
                  {insight.monitoring_points.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm"><span className="text-amber-deep mt-0.5">→</span>{p}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* Context from caregiver */}
            {insight.context_notes && (
              <section className="mb-5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-primary mb-2">Konteks dari Caregiver</div>
                <p className="text-sm text-soft italic leading-relaxed">&quot;{insight.context_notes}&quot;</p>
              </section>
            )}

            {/* Disclaimer */}
            <div className="bg-bg rounded-xl px-4 py-3.5 text-xs text-faint leading-relaxed">
              ⚠️ Informasi ini bukan diagnosis dan bukan keputusan klinis. Ini adalah ringkasan observasi yang perlu didiskusikan dengan tenaga kesehatan yang menangani pasien.
            </div>
          </div>

          {/* Generate Consultation Brief */}
          {!brief && (
            <button
              onClick={generateBrief}
              disabled={generatingBrief}
              className="w-full btn-primary text-center py-4 text-base disabled:opacity-60"
            >
              {generatingBrief ? "Membuat Consultation Brief…" : "Buat Consultation Brief"}
            </button>
          )}

          {/* Consultation Brief */}
          {brief && (
            <div className="card p-6">
              <div className="text-[11px] font-bold uppercase tracking-wide text-primary mb-4">Consultation Brief</div>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{brief}</div>
              <div className="mt-5 pt-4 border-t border-dashed border-border text-xs text-faint">
                Disusun oleh Relivia dari observasi caregiver. Bukan alat diagnosis — keputusan klinis sepenuhnya di tangan psikiater.
              </div>
            </div>
          )}

          <button onClick={() => { setStatus("idle"); setInsight(null); setBrief(null); setSessionId(null); }} className="w-full text-sm text-soft hover:text-ink font-semibold py-3">
            Kembali
          </button>
        </div>
      )}

      {/* ── Error (PRD §31) ────────────────────────── */}
      {status === "error" && errorMsg && (
        <div className="card p-6">
          <div className="text-sm text-red-deep bg-red-tint rounded-xl px-4 py-3 mb-4">
            {errorMsg.includes("unavailable") || errorMsg.includes("Gemini")
              ? "Agent analysis unavailable. Please try again later."
              : errorMsg}
          </div>
          <div className="flex gap-2">
            {sessionId && (
              <button onClick={() => loadSession(sessionId)} className="btn-primary">Coba lagi</button>
            )}
            <button onClick={() => setStatus("idle")} className="text-sm text-soft hover:text-ink font-semibold px-4 py-2">Kembali</button>
          </div>
        </div>
      )}
    </div>
  );
}
