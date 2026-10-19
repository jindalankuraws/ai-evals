// Presentation helpers shared by the model picker and the result panes.
import type { ModelInfo } from "../api";

// hard cap on how many models one comparison run may include
export const MAX_MODELS = 3;

// provider slug from a model id, e.g. "openai/gpt-4o" -> "openai"
export function providerOf(model: ModelInfo): string {
  const slash = model.id.indexOf("/");
  return slash === -1 ? "custom" : model.id.slice(0, slash);
}

// two-letter monogram from the display name, skipping version numbers so
// "Claude 3.5 Sonnet" collapses to CS instead of C3
export function monogramOf(model: ModelInfo): string {
  const words = model.name
    .split(/[\s:·]+/)
    .filter((w) => /^[a-z]/i.test(w));
  const first = words[0]?.charAt(0) ?? "?";
  const second = words[1]?.charAt(0) ?? "";
  return (first + second).toUpperCase();
}

// one hue per provider, picked by a stable hash so the same provider always
// lands on the same color without shipping per-vendor branding
const MONOGRAM_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#64748b",
];

export function monogramColor(model: ModelInfo): string {
  const slug = providerOf(model);
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  }
  return MONOGRAM_COLORS[hash % MONOGRAM_COLORS.length];
}

// OpenRouter prices are dollar strings per token; show dollars per million.
function pricePerMillion(raw?: string): number | null {
  const n = Number(raw ?? NaN);
  return Number.isFinite(n) ? n * 1_000_000 : null;
}

export function pricingLabel(model: ModelInfo): string {
  const input = pricePerMillion(model.pricing?.prompt);
  const output = pricePerMillion(model.pricing?.completion);
  if (input === null || output === null) return "";
  if (input === 0 && output === 0) return "free";
  const fmt = (v: number) => `$${v.toFixed(2)}`;
  return `${fmt(input)} in · ${fmt(output)} out`;
}

export function formatContext(tokens: number | null): string {
  if (!tokens) return "context unknown";
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M context`;
  return `${Math.round(tokens / 1_000)}K context`;
}
