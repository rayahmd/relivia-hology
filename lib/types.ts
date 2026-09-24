export type Patient = {
  id: string;
  caregiver_id: string;
  name: string;
  age: number | null;
  date_of_birth: string | null;
  note: string | null;
  created_at: string;
};

export type DailyCheckin = {
  id: string;
  patient_id: string;
  checkin_date: string;
  mood: number;
  sleep_quality: number;
  social_interaction: number;
  medication_taken: boolean;
  appetite: "decreased" | "normal" | "increased" | null;
  self_care: "decreased" | "normal" | "improved" | null;
  behavior_change: boolean;
  free_text_note: string | null;
  behavior_change_flag: boolean;
  created_at: string;
};

export type AiInsight = {
  id: string;
  patient_id: string;
  generated_at: string;
  risk_category: "low" | "medium" | "high";
  contributing_factors: string[];
  summary_text: string;
};

export type Profile = {
  id: string;
  display_name: string;
  city: string | null;
  total_checkins: number;
  is_verified: boolean;
  created_at: string;
};

export type CommunityPost = {
  id: string;
  author_id: string;
  body: string;
  helpful_count: number;
  created_at: string;
  profiles: { display_name: string; is_verified: boolean; city: string | null } | null;
};

// ─── Health Connect / Health Data ───────────────────────────

export type HealthDataType = "sleep_hours" | "steps" | "heart_rate";

export type HealthData = {
  id: string;
  patient_id: string;
  data_type: HealthDataType;
  value: number;
  unit: string;
  recorded_at: string;
  source: string;
  created_at: string;
};

// ─── Baseline ────────────────────────────────────────────────

export type Baseline = {
  id: string;
  patient_id: string;
  metric: string;
  baseline_value: number;
  baseline_min: number | null;
  baseline_max: number | null;
  sample_count: number;
  calculated_at: string;
};

// ─── Change Detection ────────────────────────────────────────

export type ChangeSeverity = "normal" | "meaningful_change" | "significant_change";

export type DetectedChange = {
  id: string;
  patient_id: string;
  metric: string;
  baseline_value: number;
  current_value: number;
  change_percent: number;
  severity: ChangeSeverity;
  detected_at: string;
};

// ─── Agent Session ───────────────────────────────────────────

export type AgentStatus = "investigating" | "waiting_for_caregiver" | "completed";

export type AgentSession = {
  id: string;
  patient_id: string;
  trigger: string;
  status: AgentStatus;
  current_context: Record<string, unknown>;
  questions_asked: string[];
  caregiver_responses: string[];
  analysis_history: Record<string, unknown>[];
  created_at: string;
  updated_at: string;
};

// ─── Clinical Insight (new, agent-driven) ────────────────────

export type ClinicalInsight = {
  id: string;
  patient_id: string;
  agent_session_id: string | null;
  detected_changes: { metric: string; baseline: number; current: number; change_percent: number }[];
  related_factors: string[];
  monitoring_points: string[];
  context_notes: string | null;
  interpretation: string | null;
  summary: string | null;
  created_at: string;
};

// ─── Consultation Brief ──────────────────────────────────────

export type ConsultationBrief = {
  id: string;
  patient_id: string;
  insight_id: string | null;
  observation_period_start: string | null;
  observation_period_end: string | null;
  key_changes: string[];
  baseline_comparison: Record<string, { baseline: number; current: number; unit: string; change_percent?: number }>;
  caregiver_observation: string | null;
  medication_status: string | null;
  relevant_history: string | null;
  questions_for_consultation: string[];
  full_content: string | null;
  created_at: string;
};
