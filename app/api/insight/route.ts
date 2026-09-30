import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreatePatient } from "@/lib/getOrCreatePatient";
import { extractGeminiText } from "@/lib/agentCore";

const SYSTEM_PROMPT = `You are a clinical documentation assistant for a caregiver-facing app called Relivia.
You do NOT diagnose or predict relapse. You summarize caregiver observations and highlight
notable changes for a psychiatrist's reference.

Rules:
- Never output a numeric risk score or percentage.
- risk_category must be exactly one of: "low", "medium", "high".
- contributing_factors: 3-5 short bullet strings in Bahasa Indonesia, each referencing a concrete
  pattern in the data provided (do not invent facts not present in the input).
- clinical_summary: 2-3 sentences in Bahasa Indonesia, written for a psychiatrist, plain and factual.
- Respond with ONLY strict JSON matching this shape, no markdown, no preamble:
  {"risk_category": "low" | "medium" | "high", "contributing_factors": string[], "clinical_summary": string}`;

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// local fetch (not the shared postGemini): retry needs the raw response
// for status + retry-after headers.
async function callGemini(payload: unknown): Promise<Response> {
  return fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
}

async function geminiErrorDetail(res: Response) {
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    return (body.error?.status ?? "") + " " + (body.error?.message ?? text);
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

function messageFor(status: number, detail: string) {
  const d = detail.toLowerCase();
  if (status === 429 || d.includes("resource_exhausted")) {
    if (d.includes("rate_limit") || d.includes("requests per")) {
      return "Terlalu banyak permintaan dalam satu menit — tunggu sebentar lalu coba lagi.";
    }
    return "Kuota Gemini API habis/ulang permintaan belum tersedia. Cek kuota hari ini di aistudio.google.com, lalu coba lagi nanti.";
  }
  if (status === 401 || status === 403) {
    return "Kunci Gemini API tidak valid atau tidak boleh mengakses model ini. Periksa GEMINI_API_KEY di .env.local.";
  }
  if (status === 404) {
    return "Model Gemini tidak tersedia untuk kunci API ini. Cek model yang didukung di aistudio.google.com.";
  }
  if (status >= 500) {
    return "Layanan Gemini sedang sibuk — coba lagi dalam beberapa saat.";
  }
  return `Gemini menolak permintaan (${status}).`;
}

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const patient = await getOrCreatePatient();

  const { data: checkins } = await supabase
    .from("daily_checkins")
    .select("*")
    .eq("patient_id", patient.id)
    .order("checkin_date", { ascending: true })
    .limit(14);

  if (!checkins || checkins.length < 3) {
    return NextResponse.json(
      { error: "Butuh minimal 3 hari catatan sebelum insight bisa dibuat." },
      { status: 400 }
    );
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY belum diset di environment variables." },
      { status: 500 }
    );
  }

  const inputData = checkins.map((c) => ({
    date: c.checkin_date,
    mood: c.mood,
    sleep_quality: c.sleep_quality,
    social_interaction: c.social_interaction,
    medication_taken: c.medication_taken,
    note: c.free_text_note,
  }));

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: `14-day caregiver observation data (JSON):\n${JSON.stringify(inputData, null, 2)}` }] }],
    generationConfig: { maxOutputTokens: 800, responseMimeType: "application/json" },
  };

  // retry transient failures (429 / 5xx) with exponential backoff.
  let geminiRes: Response | null = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    geminiRes = await callGemini(payload);
    if (geminiRes.ok) break;
    const detail = await geminiErrorDetail(geminiRes);
    if (geminiRes.status === 429 && detail.toLowerCase().includes("requests per")) {
      // explicit rate-limit window.
      const retryMs = Number(geminiRes.headers.get("retry-after") ?? "") * 1000;
      await sleep(retryMs > 0 && attempt < 2 ? retryMs : 1000 * 2 ** attempt);
      continue;
    }
    if (geminiRes.status >= 500 && attempt < 2) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    return NextResponse.json({ error: messageFor(geminiRes.status, detail), detail }, { status: geminiRes.status });
  }

  if (!geminiRes || !geminiRes.ok) {
    const detail = geminiRes ? await geminiErrorDetail(geminiRes) : "Gemini API tidak merespons.";
    return NextResponse.json(
      { error: messageFor(geminiRes?.status ?? 502, detail), detail },
      { status: geminiRes?.status ?? 502 }
    );
  }

  const data = await geminiRes.json();
  const rawText: string = extractGeminiText(data);

  if (!rawText.trim()) {
    return NextResponse.json({ error: "Gemini mengembalikan respons tanpa isi.", raw: data }, { status: 502 });
  }

  let parsed: { risk_category: string; contributing_factors: string[]; clinical_summary: string };
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
    return NextResponse.json({ error: "AI mengembalikan format yang tidak bisa dibaca.", raw: rawText }, { status: 502 });
  }

  const { data: saved, error } = await supabase
    .from("ai_insights")
    .insert({
      patient_id: patient.id,
      risk_category: parsed.risk_category,
      contributing_factors: parsed.contributing_factors,
      summary_text: parsed.clinical_summary,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ insight: saved });
}