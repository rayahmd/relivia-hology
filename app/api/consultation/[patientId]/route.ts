import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

const METRIC_LABELS: Record<string, string> = {
  steps: "Aktivitas harian",
  sleep_hours: "Durasi tidur",
  heart_rate: "Denyut jantung",
};

const METRIC_UNITS: Record<string, string> = {
  steps: "langkah",
  sleep_hours: "jam",
  heart_rate: "bpm",
};

function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMetricValue(metric: string, value: number): string {
  if (metric === "steps") return Math.round(value).toLocaleString("id-ID");
  if (metric === "sleep_hours") return `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })} jam`;
  if (metric === "heart_rate") return `${Math.round(value)} bpm`;
  return String(value);
}

function formatChangePercent(baseline: number, current: number): string {
  if (!baseline) return "";
  const pct = ((current - baseline) / Math.abs(baseline)) * 100;
  const arrow = pct < 0 ? "↓" : pct > 0 ? "↑" : "→";
  return `${arrow} ${Math.abs(pct).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
}

function humanizeKeyChange(raw: string, metric?: string, baseline?: number, current?: number): string {
  let s = raw;
  // Replace raw variable names with human labels if model still emits them
  for (const [key, label] of Object.entries(METRIC_LABELS)) {
    s = s.replace(new RegExp(key.replace(/_/g, "[_ ]?"), "gi"), label);
  }
  s = s.replace(/sleep_hours/gi, "Durasi tidur").replace(/\bsteps\b/gi, "Aktivitas harian");
  return s;
}

const BRIEF_SYSTEM_PROMPT = `You are Relivia Agent, a clinical documentation assistant. Generate a structured Consultation Brief that reads as YOUR analysis result — data → deviation from baseline → caregiver context → summary → consultation points — for a caregiver to share with their patient's psychiatrist.

RULES:
- Write in Bahasa Indonesia
- Be factual and concise, not alarmist
- NEVER use "relapse", "kambuh", or give diagnostic / clinical claims
- NEVER invent information not present in the provided data. If caregiver context is minimal, say what is available only.
- key_changes: use HUMAN labels, NEVER raw variable names. Use "Aktivitas harian menurun", "Durasi tidur menurun", "Denyut jantung meningkat" — NEVER "steps", "sleep_hours", "heart_rate".
- caregiver_observation: a NATURAL narrative paragraph summarising what the caregiver actually reported (from KONTEKS / JAWABAN CAREGIVER). Do NOT dump raw Q&A, form responses, or bullet raw answers. If no caregiver info exists, write "Tidak ada observasi caregiver yang tercatat pada periode ini."
- full_summary: 2-3 sentence narrative combining the detected wearable/deviation data AND the available caregiver observation. Not a generic template sentence.
- questions_for_consultation: contextual to the detected changes — e.g. clarifying the observed sleep/activity change, the caregiver observation, and what background context needs clarification. Do not invent factors the caregiver never mentioned; phrase unknowns as things to clarify/confirm.
- Always include disclaimer that this is not a clinical diagnosis
- Format: structured JSON only, no markdown

Respond with valid JSON:
{
  "key_changes": ["change 1", "change 2"],
  "caregiver_observation": "natural narrative paragraph of what caregiver reported, grounded only on given data",
  "questions_for_consultation": ["question 1", "question 2"],
  "full_summary": "2-3 sentence narrative combining wearable changes and caregiver observation, Bahasa Indonesia"
}`;

/** Gemini call with a hard timeout — a hanging upstream must never wedge the UI. */
const GEMINI_TIMEOUT_MS = 60_000;

async function callGemini(context: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: BRIEF_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: context }] }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.2 },
      }),
      cache: "no-store",
      signal: ctrl.signal,
    });

    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("BRIEF_GEMINI_TIMEOUT");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { patientId: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { patientId } = params;

    // Verify ownership
    const { data: patient } = await supabase
      .from("patients")
      .select("*")
      .eq("id", patientId)
      .eq("caregiver_id", user.id)
      .single();
    if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Get latest consultation brief
    const { data: brief } = await supabase
      .from("consultation_briefs")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({ brief: brief ?? null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { patientId: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { patientId } = params;
    const body = await req.json().catch(() => ({}));
    const insight_id: string | undefined = body.insight_id;

    // Verify ownership
    const { data: patient } = await supabase
      .from("patients")
      .select("*")
      .eq("id", patientId)
      .eq("caregiver_id", user.id)
      .single();
    if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Fetch the referenced insight
    let insight = null;
    if (insight_id) {
      const { data } = await supabase
        .from("insights")
        .select("*")
        .eq("id", insight_id)
        .single();
      insight = data;
    } else {
      const { data } = await supabase
        .from("insights")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      insight = data;
    }

    // Fetch recent checkins for medication info
    const { data: checkins } = await supabase
      .from("daily_checkins")
      .select("*")
      .eq("patient_id", patientId)
      .order("checkin_date", { ascending: false })
      .limit(7);

    // Fetch baselines for comparison
    const { data: baselines } = await supabase
      .from("baselines")
      .select("*")
      .eq("patient_id", patientId);

    const baselineMap: Record<string, number> = {};
    for (const b of baselines ?? []) baselineMap[b.metric] = b.baseline_value;

    // Get related agent session
    let session = null;
    if (insight?.agent_session_id) {
      const { data } = await supabase
        .from("agent_sessions")
        .select("*")
        .eq("id", insight.agent_session_id)
        .single();
      session = data;
    }

    const medicationAdherence = checkins?.length
      ? Math.round((checkins.filter((c) => c.medication_taken).length / checkins.length) * 100)
      : null;

    const observationStart = checkins?.length
      ? checkins[checkins.length - 1]?.checkin_date
      : null;
    const observationEnd = checkins?.[0]?.checkin_date ?? null;

    const contextForGemini = `
Pasien: ${patient.name}
Periode observasi: ${observationStart ?? "-"} s/d ${observationEnd ?? "-"}
Relivia Agent — susun brief sebagai hasil analisis, dengan alur: data → deviasi dari baseline → konteks caregiver → ringkasan → poin konsultasi.

PERUBAHAN TERDETEKSI (deviasi dari baseline):
${(insight?.detected_changes ?? []).map((c: { metric: string; baseline: number; current: number; change_percent: number }) =>
  `- ${metricLabel(c.metric)}: ${formatMetricValue(c.metric, c.current)} (baseline: ${formatMetricValue(c.metric, c.baseline)}, perubahan: ${c.change_percent > 0 ? "+" : ""}${String(c.change_percent).replace(".", ",")}%)`
).join("\n") || "Tidak ada data perubahan tersedia."}

BASELINE PASIEN:
${Object.entries(baselineMap).map(([k, v]) => `- ${metricLabel(k)}: ${formatMetricValue(k, v)}`).join("\n")}

FAKTOR TERKAIT:
${(insight?.related_factors ?? []).join(", ")}

POIN PEMANTAUAN:
${(insight?.monitoring_points ?? []).join(", ")}

KONTEKS DARI CAREGIVER:
${insight?.context_notes ?? "-"}

RINGKASAN INSIGHT:
${insight?.summary ?? "-"}

JAWABAN CAREGIVER SELAMA INVESTIGASI:
${(session?.caregiver_responses ?? []).join("; ") || "-"}

KEPATUHAN OBAT (${checkins?.length ?? 0} hari tercatat): ${medicationAdherence != null ? medicationAdherence + "%" : "Tidak diketahui"}

Buat Consultation Brief yang komprehensif berdasarkan semua informasi di atas. Tulis seolah hasil analisis Relivia Agent, bukan tempelan raw data.
`;

    const rawGemini = await callGemini(contextForGemini);
    let briefData: {
      key_changes: string[];
      caregiver_observation: string;
      questions_for_consultation: string[];
      full_summary: string;
    };

    try {
      const cleaned = rawGemini.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      briefData = JSON.parse(cleaned);
      // Normalize: never leak raw variable names to the client
      briefData.key_changes = (briefData.key_changes ?? []).map((c) => humanizeKeyChange(String(c)));
    } catch {
      // Deterministic grounded fallback — no raw data dump, no invented facts
      const changes = (insight?.detected_changes ?? []) as { metric: string; baseline: number; current: number; change_percent: number }[];
      const caregiverBits = [
        insight?.context_notes,
        ...((session?.caregiver_responses ?? []) as string[]),
      ].filter((s): s is string => !!s && s.trim().length > 0);
      const caregiverNarrative = caregiverBits.length
        ? `Caregiver melaporkan: ${caregiverBits.join(". ").replace(/\.\.+/g, ".")}`
        : "Tidak ada observasi caregiver yang tercatat pada periode ini.";
      const changePhrases = changes.map((c) => {
        const dir = c.change_percent < 0 ? "menurun" : c.change_percent > 0 ? "meningkat" : "stabil";
        return `${metricLabel(c.metric)} ${dir} (${formatMetricValue(c.metric, c.baseline)} → ${formatMetricValue(c.metric, c.current)}, ${formatChangePercent(c.baseline, c.current)})`;
      });
      briefData = {
        key_changes: changes.map((c) => {
          const dir = c.change_percent < 0 ? "menurun" : c.change_percent > 0 ? "meningkat" : "stabil";
          return `${metricLabel(c.metric)} ${dir}`;
        }),
        caregiver_observation: caregiverNarrative,
        questions_for_consultation: [
          ...changes.map((c) => `Perubahan ${metricLabel(c.metric).toLowerCase()} (${formatMetricValue(c.metric, c.baseline)} → ${formatMetricValue(c.metric, c.current)}) — apakah perlu diklarifikasi penyebab atau konteksnya?`),
          caregiverBits.length
            ? "Observasi caregiver di atas — apakah ada konteks/faktor terkait yang perlu diklarifikasi lebih lanjut saat konsultasi?"
            : "Apakah ada konteks atau faktor lain dari caregiver yang perlu diklarifikasi pada periode ini?",
        ].slice(0, 4),
        full_summary: changePhrases.length
          ? `Pada periode observasi tercatat ${changePhrases.join(" dan ")}. ${caregiverNarrative} Catatan ini disusun sebagai bahan diskusi dan bukan diagnosis klinis.`
          : `${caregiverNarrative} Belum ada deviasi wearable yang tercatat pada periode ini.`,
      };
    }

    const baselineComparison: Record<string, { baseline: number; current: number; unit: string; change_percent: number }> = {};
    for (const c of insight?.detected_changes ?? []) {
      const ch = c as { metric: string; baseline: number; current: number; change_percent?: number };
      const pct = typeof ch.change_percent === "number"
        ? ch.change_percent
        : ch.baseline
          ? ((ch.current - ch.baseline) / Math.abs(ch.baseline)) * 100
          : 0;
      baselineComparison[ch.metric] = {
        baseline: ch.baseline,
        current: ch.current,
        unit: METRIC_UNITS[ch.metric] ?? "",
        change_percent: Math.round(pct * 10) / 10,
      };
    }

    const recordedDays = checkins?.length ?? 0;

    const { data: savedBrief, error } = await supabase
      .from("consultation_briefs")
      .insert({
        patient_id: patientId,
        insight_id: insight?.id ?? null,
        observation_period_start: observationStart,
        observation_period_end: observationEnd,
        key_changes: briefData.key_changes,
        baseline_comparison: baselineComparison,
        caregiver_observation: briefData.caregiver_observation,
        medication_status: medicationAdherence != null ? `${medicationAdherence}% · ${recordedDays} hari tercatat` : "Tidak diketahui",
        questions_for_consultation: briefData.questions_for_consultation,
        full_content: briefData.full_summary,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ brief: savedBrief });
  } catch (err) {
    console.error("[consultation]", err);
    const msg = String(err);
    // Timeout upstream → 504 + pesan ramah agar UI selalu dapat respons.
    if (msg.includes("BRIEF_GEMINI_TIMEOUT")) {
      return NextResponse.json(
        { error: "AI sedang sibuk dan tidak merespons tepat waktu. Coba lagi." },
        { status: 504 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
