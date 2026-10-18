import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { fetchModels, RunConflictError, streamRun, type ModelInfo, type RunResult } from "./api";

// the shared params the engine can apply to every selected model —
// these are the "apple-to-apple" knobs; all optional (provider default)
type ParamKey = "temperature" | "top_p" | "max_tokens";
const SHARED_PARAMS: Array<{ key: ParamKey; label: string; step: number; min?: number; max?: number }> = [
  { key: "temperature", label: "temperature", step: 0.1, min: 0, max: 2 },
  { key: "top_p", label: "top_p", step: 0.05, min: 0, max: 1 },
  { key: "max_tokens", label: "max_tokens", step: 64 },
];

const MAX_MODELS = 3;

interface PaneState {
  status: "streaming" | "done" | "error";
  text: string;
  usage?: RunResult;
  error?: string;
}

// searchable dropdown — the catalog has hundreds of models, a plain select
// would be unusable. Supports picking several; already-selected models stay
// visible but can't be picked twice.
function ModelPicker({
  models,
  selected,
  onAdd,
  disabled,
}: {
  models: ModelInfo[];
  selected: ModelInfo[];
  onAdd: (m: ModelInfo) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const atCap = selected.length >= MAX_MODELS;
  const selectedIds = new Set(selected.map((m) => m.id));
  const matches = models
    .filter((m) => (m.name + " " + m.id).toLowerCase().includes(query.toLowerCase()))
    .slice(0, 40);

  return (
    <div className="relative">
      <label className="mb-1 block text-sm font-medium text-slate-700">
        Models to compare ({selected.length}/{MAX_MODELS})
      </label>
      <button
        type="button"
        disabled={disabled || atCap}
        onClick={() => setOpen(!open)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {atCap ? "Maximum reached — remove a model to add another" : "Search models…"}
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
            {matches.map((m) => {
              const picked = selectedIds.has(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={picked || atCap}
                    onClick={() => {
                      onAdd(m);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`w-full px-3 py-2 text-left text-sm ${
                      picked ? "cursor-not-allowed bg-slate-50 text-slate-400" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="ml-2 text-xs text-slate-400">{m.id}</span>
                    {picked && <span className="ml-2 text-xs text-slate-400">already selected</span>}
                  </button>
                </li>
              );
            })}
            {matches.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

// unsupported: at least one selected model can't take this param (dimmed)
// blocked: the param is set AND unsupported — the run is gated until fixed
function ParamField({
  label,
  value,
  onChange,
  step,
  min,
  max,
  unsupported,
  blocked,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step: number;
  min?: number;
  max?: number;
  unsupported?: boolean;
  blocked?: boolean;
}) {
  const ringClass = blocked ? " border-red-400 focus:border-red-500" : " border-slate-300 focus:border-slate-400";
  return (
    <label className={`block ${unsupported ? "opacity-50" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        placeholder="default"
        title={unsupported ? "Not supported by one or more selected models" : undefined}
        className={`w-full rounded-lg px-3 py-2 text-sm outline-none${ringClass}`}
      />
    </label>
  );
}

export default function App() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsError, setModelsError] = useState("");
  const [selected, setSelected] = useState<ModelInfo[]>([]);

  const [prompt, setPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [params, setParams] = useState<Record<ParamKey, string>>({
    temperature: "",
    top_p: "",
    max_tokens: "",
  });

  const [panes, setPanes] = useState<Record<string, PaneState>>({});
  const [runError, setRunError] = useState("");
  const [running, setRunning] = useState(false);

  const paneRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    fetchModels()
      .then(setModels)
      .catch((e) => setModelsError(e instanceof Error ? e.message : String(e)));
  }, []);

  // keep streaming panes scrolled to the bottom
  useEffect(() => {
    for (const [id, pane] of Object.entries(panes)) {
      if (pane?.status === "streaming") {
        paneRefs.current[id]?.scrollTo({ top: paneRefs.current[id].scrollHeight });
      }
    }
  }, [panes]);

  // same gate the backend applies: a set param must be supported by every model
  const conflicts = useMemo(() => {
    const list: string[] = [];
    for (const p of SHARED_PARAMS) {
      if (params[p.key] === "") continue;
      for (const m of selected) {
        if (!m.supported_parameters.includes(p.key)) {
          list.push(`"${p.key}" is set but ${m.name} does not support it — clear it or remove the model.`);
        }
      }
    }
    return list;
  }, [selected, params]);

  const paramUnsupported = (key: ParamKey) =>
    selected.some((m) => !m.supported_parameters.includes(key));

  function addModel(m: ModelInfo) {
    if (running || selected.some((s) => s.id === m.id) || selected.length >= MAX_MODELS) return;
    setSelected((prev) => [...prev, m]);
  }

  function removeModel(id: string) {
    if (running) return;
    setSelected((prev) => prev.filter((m) => m.id !== id));
    setPanes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function setParam(key: ParamKey, value: string) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  async function handleRun() {
    if (running || !prompt.trim() || selected.length === 0 || conflicts.length > 0) return;

    const modelIds = selected.map((m) => m.id);
    const initial: Record<string, PaneState> = {};
    for (const id of modelIds) initial[id] = { status: "streaming", text: "" };
    setPanes(initial);
    setRunError("");
    setRunning(true);

    const sharedParams: Record<string, number> = {};
    for (const p of SHARED_PARAMS) {
      if (params[p.key] !== "") sharedParams[p.key] = Number(params[p.key]);
    }

    try {
      await streamRun(
        { model_ids: modelIds, prompt, system_prompt: systemPrompt, params: sharedParams },
        {
          onToken: (id, text) =>
            setPanes((prev) => ({ ...prev, [id]: { ...prev[id], text: prev[id].text + text } })),
          onDone: (id, usage) =>
            setPanes((prev) => ({ ...prev, [id]: { ...prev[id], status: "done", usage } })),
          onError: (id, message) => {
            if (!id) {
              // whole-run failure (backend unreachable, bad payload…)
              setRunError(message);
              return;
            }
            setPanes((prev) => ({ ...prev, [id]: { ...prev[id], status: "error", error: message } }));
          },
        },
      );
    } catch (e) {
      if (e instanceof RunConflictError) {
        setRunError(e.conflicts.join(" "));
      } else {
        setRunError(e instanceof Error ? e.message : String(e));
      }
      // anything still streaming is dead — the request failed
      setPanes((prev) => {
        const next = { ...prev };
        for (const [id, p] of Object.entries(next)) {
          if (p.status === "streaming") next[id] = { ...p, status: "error", error: p.error ?? "Run failed" };
        }
        return next;
      });
    } finally {
      setRunning(false);
    }
  }

  const canRun = !running && selected.length > 0 && prompt.trim() !== "" && conflicts.length === 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Model Comparison</h1>
        <p className="mt-1 text-sm text-slate-500">
          Compare model outputs side by side under identical prompt and inference settings.
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {modelsError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Failed to load the model catalog: {modelsError}
          </div>
        )}
        <ModelPicker models={models} selected={selected} onAdd={addModel} disabled={running} />
        {selected.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selected.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-sm"
              >
                {m.name}
                <button
                  type="button"
                  disabled={running}
                  onClick={() => removeModel(m.id)}
                  className="rounded-full px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:opacity-40"
                  title="Remove"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          {SHARED_PARAMS.map((p) => (
            <ParamField
              key={p.key}
              label={p.label}
              value={params[p.key]}
              onChange={(v) => setParam(p.key, v)}
              step={p.step}
              min={p.min}
              max={p.max}
              unsupported={paramUnsupported(p.key)}
              blocked={params[p.key] !== "" && paramUnsupported(p.key)}
            />
          ))}
        </div>
        {conflicts.length > 0 && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">Shared parameters don't apply to every selected model:</p>
            <ul className="mt-1 list-disc pl-5">
              {conflicts.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="System prompt (optional)"
          rows={2}
          className="mb-3 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Prompt"
          rows={3}
          className="mb-3 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
        />

        {runError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {runError}
          </div>
        )}

        <button
          type="button"
          disabled={!canRun}
          onClick={handleRun}
          className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "Running…" : "Run"}
        </button>
      </div>

      {selected.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {selected.map((m) => (
            <OutputPane
              key={m.id}
              model={m}
              pane={panes[m.id]}
              scrollRef={(el) => {
                paneRefs.current[m.id] = el;
              }}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400">Select models and enter a prompt to start a comparison run.</p>
      )}
    </div>
  );
}

function OutputPane({
  model,
  pane,
  scrollRef,
}: {
  model: ModelInfo;
  pane?: PaneState;
  scrollRef: (el: HTMLDivElement | null) => void;
}) {
  const streaming = pane?.status === "streaming";
  const errored = pane?.status === "error";
  const usage = pane?.usage;

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <span className="truncate text-sm font-medium text-slate-800" title={model.id}>
          {model.name}
        </span>
        <span
          className={`ml-2 shrink-0 text-xs ${
            streaming ? "text-blue-600" : errored ? "text-red-600" : "text-slate-400"
          }`}
        >
          {streaming ? "streaming…" : errored ? "failed" : pane?.status === "done" ? "done" : "idle"}
        </span>
      </div>
      {pane?.status === "done" && usage && (
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-1 text-xs text-slate-500">
          {usage.prompt_tokens ?? "–"} prompt tokens · {usage.completion_tokens ?? "–"} completion tokens
          {usage.latency_ms ? ` · ${(usage.latency_ms / 1000).toFixed(1)}s` : ""}
          {usage.finish_reason ? ` · ${usage.finish_reason}` : ""}
        </div>
      )}
      <div
        ref={scrollRef}
        className="prose prose-sm max-w-none flex-1 overflow-y-auto p-4 text-sm leading-relaxed text-slate-800"
        style={{ minHeight: "18rem", maxHeight: "36rem" }}
      >
        {pane === undefined ? (
          <span className="text-slate-400">Not run yet.</span>
        ) : pane.status === "error" ? (
          <span className="text-red-600">{pane.error ?? "Something went wrong."}</span>
        ) : (
          <ReactMarkdown>{pane.text}</ReactMarkdown>
        )}
      </div>
    </div>
  );
}
