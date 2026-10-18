// Typed client for the backend API. All requests go through here.

const BACKEND_URL = "http://localhost:8000";

export interface ModelInfo {
  id: string;
  name: string;
  context_length: number | null;
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

export interface RunHandlers {
  onToken: (text: string) => void;
  onDone: (result: RunResult) => void;
  onError: (message: string) => void;
}

export interface RunInput {
  model_id: string;
  prompt: string;
  system_prompt: string;
  params: SharedParams;
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${BACKEND_URL}/api/models`);
  if (!res.ok) throw new Error(`Could not load models (HTTP ${res.status})`);
  return res.json();
}

// One request per run: the answer streams back on the same response body as
// SSE-formatted messages. We read it with a plain reader because EventSource
// only supports GET, which doesn't fit a POST.
export async function streamRun(input: RunInput, handlers: RunHandlers): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok || !res.body) {
    let detail = "";
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // ignore body parse issues — fall back to the status code
    }
    handlers.onError(detail || `Request failed (HTTP ${res.status})`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let settled = false; // did we ever receive a done or error event?

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
    if (name === "token") {
      handlers.onToken(String(payload.text ?? ""));
    } else if (name === "done") {
      settled = true;
      handlers.onDone(payload as RunResult);
    } else if (name === "error") {
      settled = true;
      handlers.onError(String(payload.message ?? "Unknown error"));
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

  if (!settled) {
    handlers.onError("The stream ended before the run finished.");
  }
}
