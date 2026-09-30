// single source of truth for agent prompt, gemini transport, decision
// parsing, and answer options — manual + automatic pipelines share it.

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

/** gemini failure throws — callers must not fabricate insights. */
export async function callGeminiInvestigate(contextText: string): Promise<string> {
  const res = await postGemini({
    systemPrompt: AGENT_SYSTEM_PROMPT,
    contents: [{ role: "user", parts: [{ text: contextText }] }],
    maxOutputTokens: 1200,
    temperature: 0.3,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }

  return extractGeminiText(await res.json());
}

export type GeminiContents = Array<{
  role: string;
  parts: Array<{ text: string }>;
}>;

/** shared gemini transport: same headers + no-store everywhere. */
export async function postGemini(opts: {
  model?: string;
  systemPrompt: string;
  contents: GeminiContents;
  maxOutputTokens: number;
  temperature: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
  try {
    return await fetch(
      opts.model ?? GEMINI_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.systemPrompt }] },
          contents: opts.contents,
          generationConfig: {
            maxOutputTokens: opts.maxOutputTokens,
            temperature: opts.temperature,
            ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
          },
        }),
        cache: "no-store",
        ...(timer ? { signal: ctrl.signal } : {}),
      }
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** join model text parts into one string. */
export function extractGeminiText(data: {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}): string {
  return (
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? ""
  );
}

/** strip code fences before json.parse. */
export function cleanGeminiJson(raw: string): string {
  return raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

/** per-round answer options live in session context (no db migration). */
export type AgentChange = {
  metric: string;
  label: string;
  baseline_value: number;
  current_value: number;
  change_percent: number;
  severity: string;
};

export type AgentSessionContext = {
  changes?: AgentChange[];
  question_options?: string[][];
  [key: string]: unknown;
};

export function getStoredOptions(ctx: AgentSessionContext, round: number): string[] | null {
  const stored = ctx.question_options?.[round];
  return stored && stored.length >= 2 ? stored : null;
}

export function withAppendedOptions(
  ctx: AgentSessionContext,
  options: string[]
): AgentSessionContext {
  return { ...ctx, question_options: [...(ctx.question_options ?? []), options] };
}

/** parse agent json; unparseable falls back to the default question. */
export function parseAgentDecision(raw: string): AgentDecision {
  try {
    const parsed = JSON.parse(cleanGeminiJson(raw)) as AgentDecision;
    // ai sometimes omits options — guarantee contextual ones server-side.
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
 * deterministic options by question topic for when the ai omits
 * answer_options (or gemini is down). keyword match on the question text
 * also keeps old sessions without stored options working.
 */
// ponytail: keyword heuristic, upgrade to per-question ai options only (already primary path)
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

/** keep ai options (max 4, trimmed, deduped) or fall back by topic. */
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
