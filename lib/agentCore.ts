/**
 * Shared Relivia Agent core (PRD §16–§19).
 *
 * Single source of truth for the investigation prompt, Gemini call, and
 * response parsing — used by both the manual /api/agent/investigate route
 * and the automatic pipeline (lib/autoTrigger.ts) so behavior is identical.
 *
 * Safety rules are part of the system prompt: never diagnose, never predict
 * relapse, never give medication advice (PRD out-of-scope).
 */

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

export const AGENT_SYSTEM_PROMPT = `You are Relivia Agent, an AI that helps caregivers of schizophrenia patients monitor behavioral changes.

CRITICAL SAFETY RULES — NEVER VIOLATE:
- NEVER use words like "relapse", "kambuh", "diagnosis", "terdiagnosis"
- NEVER state the patient is definitely deteriorating
- NEVER give medication advice
- ALWAYS include a note that this is not a clinical diagnosis
- Use phrases like "meaningful change from baseline", "pattern worth discussing with a psychiatrist"

YOUR ROLE:
You investigate changes in patient behavior data. Given the current context:
1. Determine if you have enough information to generate a clinical insight
2. If NOT enough info: generate ONE focused follow-up question to ask the caregiver
3. If enough info: generate the clinical insight

ALWAYS respond with ONLY valid JSON, no markdown, in this exact format:

If you need more information:
{
  "needs_more_info": true,
  "question": "Your focused question in Bahasa Indonesia",
  "question_focus": "what specific gap this question addresses",
  "answer_options": ["option 1 in Bahasa Indonesia", "option 2", "option 3"]
}

RULES FOR answer_options:
- 2 to 4 short options (max ~40 chars each), written for a caregiver
- Each option must directly answer THIS question — never reuse generic
  yes/no templates across different topics (sleep needs sleep answers,
  medication needs medication answers, social needs social answers)
- Natural, non-leading, non-alarming; always allow "Tidak yakin" style
  uncertainty as one option when it fits
- The caregiver can always type a free-text answer instead, so options
  are shortcuts, not constraints

If you have enough information:
{
  "needs_more_info": false,
  "insight": {
    "summary": "2-3 sentence summary in Bahasa Indonesia",
    "detected_changes": ["change description 1", "change description 2"],
    "related_factors": ["factor 1", "factor 2"],
    "monitoring_points": ["what to watch 1", "what to watch 2"],
    "interpretation": "1-2 sentence interpretation in Bahasa Indonesia, factual and non-alarmist",
    "context_notes": "context from caregiver answers if any"
  }
}`;

export const DEFAULT_QUESTION =
  "Apakah pasien akhir-akhir ini lebih sering menghindari interaksi dengan orang lain di sekitarnya?";
export const DEFAULT_QUESTION_FOCUS = "social_withdrawal";

export type AgentInsight = {
  summary: string;
  detected_changes: string[];
  related_factors: string[];
  monitoring_points: string[];
  interpretation: string;
  context_notes: string;
};

export type AgentDecision = {
  needs_more_info: boolean;
  question?: string;
  question_focus?: string;
  answer_options?: string[];
  insight?: AgentInsight;
};

/** Strict PRD §31: Gemini failure throws — callers must NOT fabricate insights. */
export async function callGeminiInvestigate(contextText: string): Promise<string> {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: AGENT_SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: contextText }] }],
      generationConfig: { maxOutputTokens: 1200, temperature: 0.3 },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("") ?? ""
  );
}

/** Parse agent JSON; falls back to one default question when unparseable. */
export function parseAgentDecision(raw: string): AgentDecision {
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as AgentDecision;
    // AI sometimes omits options — guarantee contextual ones server-side.
    if (parsed.needs_more_info && parsed.question) {
      parsed.answer_options = normalizeAnswerOptions(parsed.answer_options, parsed.question, parsed.question_focus);
    }
    return parsed;
  } catch {
    return {
      needs_more_info: true,
      question: DEFAULT_QUESTION,
      question_focus: DEFAULT_QUESTION_FOCUS,
      answer_options: getFallbackAnswerOptions(DEFAULT_QUESTION, DEFAULT_QUESTION_FOCUS),
    };
  }
}

/**
 * Deterministic contextual options by question topic. Used whenever the AI
 * omits answer_options (or Gemini is down), so every question — sleep,
 * social, medication, mood — still gets relevant shortcuts. Keyword match
 * on the question text keeps old sessions (no stored options) working too.
 */
// ponytail: keyword heuristic, upgrade to per-question AI options only (already primary path)
export function getFallbackAnswerOptions(question: string, focus?: string): string[] {
  const t = `${focus ?? ""} ${question}`.toLowerCase();
  if (/tidur|sleep|begadang|insomnia|bangun malam|kantuk/.test(t))
    return ["Tidur nyenyak seperti biasa", "Sering terbangun di malam hari", "Sulit memulai tidur", "Tidak terlalu yakin"];
  if (/sosial|interaksi|bergaul|menarik diri|keluar kamar|bertemu|withdrawal/.test(t))
    return ["Masih mau berinteraksi seperti biasa", "Lebih sering menyendiri", "Menghindari orang tertentu saja", "Tidak terlalu yakin"];
  if (/obat|medication|minum obat|dosis|resep/.test(t))
    return ["Minum obat teratur sesuai jadwal", "Ada jadwal yang terlewat", "Menolak minum obat", "Tidak terlalu yakin"];
  if (/makan|makanan|nafsu|appetite/.test(t))
    return ["Nafsu makan seperti biasa", "Nafsu makan berkurang", "Nafsu makan bertambah", "Tidak terlalu yakin"];
  if (/mood|suasana|emosi|marah|sedih|cemas|irritable/.test(t))
    return ["Suasana hati stabil", "Mudah marah atau tersinggung", "Terlihat murung atau muram", "Tidak terlalu yakin"];
  if (/aktivitas|aktivitas|mandi|self-care|merawat diri|semangat/.test(t))
    return ["Aktivitas seperti biasa", "Kurang semangat beraktivitas", "Butuh diingatkan untuk aktivitas", "Tidak terlalu yakin"];
  if (/perilaku|aneh|bicara sendiri|halusinasi|curiga/.test(t))
    return ["Tidak ada perilaku yang janggal", "Ada perilaku yang tidak biasa", "Kadang terlihat, kadang tidak", "Tidak terlalu yakin"];
  return ["Ya, lebih sering dari biasanya", "Tidak, masih normal", "Tidak terlalu yakin"];
}

/** Keep AI options (max 4, trimmed, deduped) or fall back by topic. */
export function normalizeAnswerOptions(
  options: unknown,
  question: string,
  focus?: string
): string[] {
  if (Array.isArray(options)) {
    const cleaned = [...new Set(
      options.filter((o): o is string => typeof o === "string").map((o) => o.trim()).filter(Boolean)
    )].slice(0, 4);
    if (cleaned.length >= 2) return cleaned;
  }
  return getFallbackAnswerOptions(question, focus);
}
