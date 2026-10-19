// Typed client for the backend API. All requests go through here.

const BACKEND_URL = "http://localhost:8000";

export interface ModelPricing {
  prompt?: string;
  completion?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  context_length: number | null;
  // dollars per token, straight from the OpenRouter catalog
  pricing?: ModelPricing | null;
  supported_parameters: string[];
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
}

// One run streams several models over a single response. Every SSE event is
// tagged with the model it belongs to, so the UI routes it to the right pane.
export interface RunHandlers {
  onToken: (modelId: string, text: string) => void;
  onDone: (modelId: string, result: RunResult) => void;
  // an empty modelId means the failure is about the whole run, not one model
  onError: (modelId: string, message: string) => void;
}

// Thrown when the backend rejects a run because a shared param isn't
// supported by every selected model — the "apple-to-apple" gate.
export class RunConflictError extends Error {
  conflicts: string[];
  constructor(conflicts: string[]) {
    super("The shared parameters don't work for every selected model.");
    this.conflicts = conflicts;
  }
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${BACKEND_URL}/api/models`);
  if (!res.ok) throw new Error(`Could not load models (HTTP ${res.status})`);
  const body = await res.json();
  return body.models as ModelInfo[];
}

// One request per run: the answers stream back on the same response body as
// SSE-formatted messages. We read it with a plain reader because EventSource
// only supports GET, which doesn't fit a POST.
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
      // ignore body parse issues — fall back to the status code
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
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(dataLine.slice(5).trim());
    } catch {
      return;
    }
    const modelId = String(payload.model_id ?? "");
    if (modelId) seen.add(modelId);
    if (name === "token") {
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

  // the backend sends an "end" event after every model settles — if a model
  // never got a done/error, the connection dropped mid-stream
  for (const modelId of seen) {
    if (!settled.has(modelId)) {
      handlers.onError(modelId, "The stream ended before this model finished.");
    }
  }
}

