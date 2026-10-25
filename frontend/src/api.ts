const BACKEND_URL = "http://localhost:8000";

export interface ModelPricing {
  prompt?: string;
  completion?: string;
}

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  context_length: number | null;
  pricing?: ModelPricing | null;
  supported_parameters: string[];
}

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

// the judge only sees letters; the backend maps them back to model ids
export interface MetricScore {
  letter: string;
  score: number;
  normalized: number; // (score-1)/4 → 0-1
  rationale: string;
}

export interface MetricResult {
  label: string;
  weight: number;
  status: "ok" | "inference_error";
  error?: string;
  scores?: Record<string, MetricScore>; // model_id -> score
}

export interface OverallEntry {
  model_id: string;
  letter: string;
  weighted_score: number; // 0-1, weight-averaged over scored metrics
}

export interface TieBreak {
  winner: string | null; // model id; null when the tie-break call failed
  rationale: string | null;
  error: string | null;
  presentation_order: string[];
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

export interface RunHandlers {
  onRunStart: (runId: string) => void;
  onToken: (modelId: string, text: string) => void;
  onDone: (modelId: string, result: RunResult) => void;
  // an empty modelId means the failure is about the whole run, not one model
  onError: (modelId: string, message: string) => void;
}

// thrown when the backend's param or judge check rejects a run with a 422
export class RunConflictError extends Error {
  conflicts: string[];
  constructor(conflicts: string[]) {
    super("The shared parameters don't work for every selected model.");
    this.conflicts = conflicts;
  }
}

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

// evaluated once per run on the backend, so a repeat call gets the cached verdict
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


function parsePayload(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// read with fetch because EventSource only supports GET and a run is a POST
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
      // fall back to the status code
    }
    // 422 lists every param or judge problem
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
  const seen = new Set<string>();
  const finished = new Set<string>();

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
      finished.add(modelId);
      handlers.onDone(modelId, payload as RunResult);
    } else if (name === "error") {
      finished.add(modelId);
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

  // no done or error for a model means the connection dropped mid-stream
  for (const modelId of seen) {
    if (!finished.has(modelId)) {
      handlers.onError(modelId, "The stream ended before this model finished.");
    }
  }
}

