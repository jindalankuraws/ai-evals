// Typed client for the backend API. All requests go through here.

const BACKEND_URL = "http://localhost:8000";

export interface ModelPricing {
  prompt?: string;
  completion?: string;
}

export interface ModelInfo {
  id: string;
  // which inference provider serves this model (openai/anthropic/openrouter/…)
  provider: string;
  name: string;
  context_length: number | null;
  // dollars per token, straight from the provider catalog
  pricing?: ModelPricing | null;
  supported_parameters: string[];
}

// one row of GET /api/providers - what the picker needs to render the
// provider step, including the setup hint shown for unconfigured rows
export interface ProviderInfo {
  slug: string;
  label: string;
  api_key_env: string;
  hint: string;
  configured: boolean;
}

export async function fetchProviders(): Promise<ProviderInfo[]> {
  const res = await fetch(`${BACKEND_URL}/api/providers`);
  if (!res.ok) throw new Error(`Providers request failed (HTTP ${res.status})`);
  const body = await res.json();
  return body.providers as ProviderInfo[];
}

export interface SharedParams {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface RunResult {
  finish_reason?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  latency_ms?: number;
}

export interface RunInput {
  model_ids: string[];
  prompt: string;
  system_prompt: string;
  params: SharedParams;
  judge_model: string;
}

// --- judge evaluation -------------------------------------------------------
// Mirrors the dict returned by POST /api/runs/{id}/evaluate (see
// backend/app/engine/judge/evaluator.py). Scores are comparative and blind:
// each model gets a letter (A/B/C) that only maps back to a model id server-side.

// one model's score on one metric
export interface MetricScore {
  letter: string; // blind letter the judge saw (A/B/C)
  score: number; // raw 1-5
  normalized: number; // (score-1)/4 → 0-1
  rationale: string;
}

// one metric's verdict across all compared models
export interface MetricResult {
  label: string;
  weight: number;
  status: "ok" | "inference_error";
  error?: string; // only when status is inference_error
  scores?: Record<string, MetricScore>; // model_id -> score; absent on inference_error
}

// one row of the weighted overall table, sorted best-first
export interface OverallEntry {
  model_id: string;
  letter: string;
  weighted_score: number; // 0-1, weight-averaged over scored metrics
}

// the masked pairwise call that decides a 0.15-band tie
export interface TieBreak {
  winner: string | null; // model id; null when the tie-break call failed
  rationale: string | null;
  error: string | null;
  presentation_order: string[]; // the randomized order the judge saw
}

export interface EvaluationResult {
  run_id: string;
  judge_model: string;
  letters: Record<string, string>; // letter -> model_id
  metrics: Record<string, MetricResult>;
  overall: OverallEntry[];
  winner: string;
  tie_break: TieBreak | null;
}

// One run streams several models over a single response. Every SSE event is
// tagged with the model it belongs to, so the UI routes it to the right pane.
// The stream opens with a `run` event carrying the run_id - the frontend
// keeps it so it can trigger the evaluate call once the stream ends.
export interface RunHandlers {
  onRunStart: (runId: string) => void;
  onToken: (modelId: string, text: string) => void;
  onDone: (modelId: string, result: RunResult) => void;
  // an empty modelId means the failure is about the whole run, not one model
  onError: (modelId: string, message: string) => void;
}

// Thrown when the backend rejects a run because a shared param isn't
// supported by every selected model - the "apple-to-apple" gate.
export class RunConflictError extends Error {
  conflicts: string[];
  constructor(conflicts: string[]) {
    super("The shared parameters don't work for every selected model.");
    this.conflicts = conflicts;
  }
}

// per-provider catalog fetch result from /api/models - explains why a
// configured provider can still show zero models (rejected key, timeout, ...)
export interface ProviderFetchStatus {
  state: "ok" | "failed" | "unconfigured";
  model_count: number;
  error: string | null;
}

export async function fetchModels(): Promise<{
  models: ModelInfo[];
  providerStatus: Record<string, ProviderFetchStatus>;
}> {
  const res = await fetch(`${BACKEND_URL}/api/models`);
  if (!res.ok) throw new Error(`Could not load models (HTTP ${res.status})`);
  const body = await res.json();
  return {
    models: body.models as ModelInfo[],
    providerStatus: (body.provider_status ?? {}) as Record<string, ProviderFetchStatus>,
  };
}

// Ask the backend to judge a finished run. The endpoint is fire-once: after
// the first call the verdict is cached, so a repeat (accidental double-click,
// React StrictMode remount) gets the same result back instead of a re-judge.
export async function evaluateRun(runId: string): Promise<EvaluationResult> {
  const res = await fetch(`${BACKEND_URL}/api/runs/${runId}/evaluate`, { method: "POST" });
  if (!res.ok) {
    let detail = `Evaluation failed (HTTP ${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // keep the status-code message
    }
    throw new Error(detail);
  }
  return res.json() as Promise<EvaluationResult>;
}


// One request per run: the answers stream back on the same response body as
// SSE-formatted messages. We read it with a plain reader because EventSource
// only supports GET, which doesn't fit a POST.
// SSE blocks carry their payload as a JSON data line; a malformed one is
// skipped rather than treated as an error.
function parsePayload(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function streamRun(input: RunInput, handlers: RunHandlers): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = (await res.json()).detail;
    } catch {
      // ignore body parse issues - fall back to the status code
    }
    // 422 means the compat gate found an incompatibility; surface every message
    if (res.status === 422 && Array.isArray(detail)) {
      throw new RunConflictError(detail.map(String));
    }
    const message = typeof detail === "string" ? detail : `Request failed (HTTP ${res.status})`;
    handlers.onError("", message);
    return;
  }
  if (!res.body) {
    handlers.onError("", "Empty response body.");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const seen = new Set<string>(); // model ids that produced any event
  const settled = new Set<string>(); // model ids that got a done or error

  const handleBlock = (block: string) => {
    const lines = block.split("\n");
    const name = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "";
    const dataLine = lines.find((l) => l.startsWith("data:"));
    if (!dataLine) return;
    const payload = parsePayload(dataLine.slice(5).trim());
    if (!payload) return;
    const modelId = String(payload.model_id ?? "");
    if (modelId) seen.add(modelId);
    if (name === "run") {
      handlers.onRunStart(String(payload.run_id ?? ""));
    } else if (name === "token") {
      handlers.onToken(modelId, String(payload.text ?? ""));
    } else if (name === "done") {
      settled.add(modelId);
      handlers.onDone(modelId, payload as RunResult);
    } else if (name === "error") {
      settled.add(modelId);
      handlers.onError(modelId, String(payload.message ?? "Unknown error"));
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    blocks.forEach(handleBlock);
  }
  if (buffer.trim()) handleBlock(buffer);

  // the backend sends an "end" event after every model settles - if a model
  // never got a done/error, the connection dropped mid-stream
  for (const modelId of seen) {
    if (!settled.has(modelId)) {
      handlers.onError(modelId, "The stream ended before this model finished.");
    }
  }
}

