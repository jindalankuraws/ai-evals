import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { fetchModels, streamRun, type ModelInfo, type RunResult } from "./api";

type RunStatus = "idle" | "streaming" | "done" | "error";

// searchable dropdown — the catalog has hundreds of models, a plain select
// would be unusable
function ModelPicker({
  models,
  value,
  onSelect,
}: {
  models: ModelInfo[];
  value: ModelInfo | null;
  onSelect: (m: ModelInfo) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matches = models
    .filter((m) => (m.name + " " + m.id).toLowerCase().includes(query.toLowerCase()))
    .slice(0, 40);

  return (
    <div className="relative">
      <label className="mb-1 block text-sm font-medium text-slate-700">Model</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm hover:border-slate-400"
      >
        {value ? value.name : "Search models…"}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to filter…"
            className="w-full border-b border-slate-100 px-3 py-2 text-sm outline-none"
          />
          <ul className="max-h-60 overflow-y-auto">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(m);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="font-medium">{m.name}</span>
                  <span className="ml-2 text-xs text-slate-400">{m.id}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="px-3 py-2 text-sm text-slate-400">No matches</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function ParamField({
  label,
  value,
  onChange,
  step,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        placeholder="default"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
      />
    </label>
  );
}

export default function App() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsError, setModelsError] = useState("");
  const [model, setModel] = useState<ModelInfo | null>(null);

  const [prompt, setPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState("");
  const [topP, setTopP] = useState("");
  const [maxTokens, setMaxTokens] = useState("");

  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [runError, setRunError] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);

  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchModels()
      .then(setModels)
      .catch((e) => setModelsError(e instanceof Error ? e.message : String(e)));
  }, []);

  // keep the streamed text scrolled into view
  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [output]);

  const running = status === "streaming";

  function optionalNumber(v: string): number | undefined {
    return v === "" ? undefined : Number(v);
  }

  async function handleRun() {
    if (!model || !prompt.trim() || running) return;
    setOutput("");
    setRunError("");
    setResult(null);
    setStatus("streaming");
    try {
      await streamRun(
        {
          model_id: model.id,
          prompt,
          system_prompt: systemPrompt,
          params: {
            temperature: optionalNumber(temperature),
            top_p: optionalNumber(topP),
            max_tokens: optionalNumber(maxTokens),
          },
        },
        {
          onToken: (text) => setOutput((prev) => prev + text),
          onDone: (r) => {
            setResult(r);
            setStatus("done");
          },
          onError: (msg) => {
            setRunError(msg);
            setStatus("error");
          },
        },
      );
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">AI Evals</h1>
        <p className="mt-1 text-slate-500">
          Run a prompt against a model and watch the answer stream in — more
          models and scoring coming next.
        </p>
      </header>

      {modelsError && (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {modelsError}
        </p>
      )}

      <section className="mt-8">
        <ModelPicker models={models} value={model} onSelect={setModel} />

        <div className="mt-4 grid grid-cols-3 gap-3">
          <ParamField
            label="temperature (0–2)"
            value={temperature}
            onChange={setTemperature}
            step={0.1}
            min={0}
            max={2}
          />
          <ParamField
            label="top_p (0–1)"
            value={topP}
            onChange={setTopP}
            step={0.05}
            min={0}
            max={1}
          />
          <ParamField label="max_tokens" value={maxTokens} onChange={setMaxTokens} step={64} />
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Leave a field empty to use the model's own default.
        </p>
      </section>

      <section className="mt-6">
        <label className="mb-1 block text-sm font-medium text-slate-700">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Ask the model something…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
        />
        <label className="mt-3 mb-1 block text-sm font-medium text-slate-700">
          System prompt <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <input
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="e.g. You are a concise assistant."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
        />
        <button
          type="button"
          onClick={handleRun}
          disabled={running || !model || !prompt.trim()}
          className="mt-4 rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {running ? "Running…" : "Run"}
        </button>
      </section>

      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-slate-700">
            {model ? model.name : "Output"}
          </h2>
          {running && (
            <span className="animate-pulse text-xs text-slate-400">streaming…</span>
          )}
          {result && (
            <span className="text-xs text-slate-400">
              finish: {result.finish_reason ?? "—"} · {result.prompt_tokens ?? "?"} prompt tok ·{" "}
              {result.completion_tokens ?? "?"} completion tok ·{" "}
              {((result.latency_ms ?? 0) / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        {status === "idle" && !output && (
          <p className="text-sm text-slate-400">Pick a model, write a prompt, and hit Run.</p>
        )}
        {runError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {runError}
          </p>
        )}
        <div ref={outputRef} className="max-h-[480px] overflow-y-auto text-sm leading-relaxed">
          <ReactMarkdown>{output}</ReactMarkdown>
        </div>
      </section>
    </div>
  );
}

