import type { ModelInfo } from "../api";

// Judge eligibility — the UI mirror of the backend's judge_conflicts gate, so
// the run never gets rejected for an obvious reason. A judge must be able to
// emit our verdict JSON (structured outputs) and must sit outside every
// compared model's family (no model grades its own siblings).
const STRUCTURED_OUTPUT_KEYS = ["structured_outputs", "response_format"];

// Auto-preselect preference order, then the first eligible catalog model.
const PREFERENCE = [
  "openai/gpt-4.1-mini",
  "google/gemini-2.5-flash",
  "anthropic/claude-sonnet-4.5",
];

export function familyOf(modelId: string): string {
  return modelId.includes("/") ? modelId.split("/")[0] : modelId;
}

export function eligibleJudges(models: ModelInfo[], selectedIds: string[]): ModelInfo[] {
  const families = new Set(selectedIds.map(familyOf));
  return models.filter(
    (m) =>
      m.supported_parameters.some((p) => STRUCTURED_OUTPUT_KEYS.includes(p)) &&
      !families.has(familyOf(m.id)),
  );
}

export function pickJudge(models: ModelInfo[], selectedIds: string[]): ModelInfo | null {
  const eligible = eligibleJudges(models, selectedIds);
  if (eligible.length === 0) return null;
  const byId = new Map(eligible.map((m) => [m.id, m] as const));
  for (const id of PREFERENCE) {
    const hit = byId.get(id);
    if (hit) return hit;
  }
  return eligible[0];
}