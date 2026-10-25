import type { ModelInfo } from "../api";

// mirrors the backend's judge_conflicts check, so a run isn't rejected for an obvious reason
const STRUCTURED_OUTPUT_KEYS = ["structured_outputs", "response_format"];

// Auto-preselect preference order, then the first eligible catalog model.
const PREFERENCE = [
  "openrouter::openai/gpt-4.1-mini",
  "openrouter::google/gemini-2.5-flash",
  "openrouter::anthropic/claude-sonnet-4.5",
];

// must match backend/app/engine/compat.py::_family
export function familyOf(modelId: string): string {
  const sep = modelId.indexOf("::");
  const provider = sep === -1 ? "openrouter" : modelId.slice(0, sep);
  const bare = sep === -1 ? modelId : modelId.slice(sep + 2);
  if (bare.includes("/")) return bare.split("/")[0];
  if (provider === "openai-compatible") return bare;
  return provider;
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