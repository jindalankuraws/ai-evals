import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchModels,
  streamRun,
  RunConflictError,
  type ModelInfo,
  type SharedParams,
} from "./api";
import ModelPicker from "./components/ModelPicker";
import OutputPane, { type PaneState } from "./components/OutputPane";
import ParamField from "./components/ParamField";
import { MAX_MODELS } from "./lib/models";

export default function App() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ModelInfo[]>([]);

  const [prompt, setPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState("");
  const [topP, setTopP] = useState("");
  const [maxTokens, setMaxTokens] = useState("");

  const [running, setRunning] = useState(false);
  const [panes, setPanes] = useState<Record<string, PaneState>>({});
  const [banner, setBanner] = useState<string | null>(null);

  const scrollRefs = useRef(new Map<string, HTMLDivElement | null>());
  const setScrollRef = useCallback((id: string, el: HTMLDivElement | null) => {
    scrollRefs.current.set(id, el);
  }, []);

  // the catalog loads once on mount
  useEffect(() => {
    fetchModels()
      .then(setModels)
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  // a shared param is unsupported when any selected model lacks it, and
  // "blocked" once it also holds a value — the run stays gated until then
  const paramState = (name: keyof SharedParams): { unsupported: boolean; blocked: boolean } => {
    const unsupported = selected.some((m) => !m.supported_parameters.includes(name));
    const value = name === "temperature" ? temperature : name === "top_p" ? topP : maxTokens;
    return { unsupported, blocked: unsupported && value.trim() !== "" };
  };

  const temp = paramState("temperature");
  const top = paramState("top_p");
  const mt = paramState("max_tokens");
  const paramsBlocked = temp.blocked || top.blocked || mt.blocked;

  const canRun = selected.length > 0 && prompt.trim() !== "" && !running && !paramsBlocked;

  const autoScroll = (modelId: string) => {
    const el = scrollRefs.current.get(modelId);
    if (el) el.scrollTop = el.scrollHeight;
  };

  async function handleRun() {
    if (!canRun) return;
    setRunning(true);
    setBanner(null);
    // fresh panes for this run; the grid keeps the new lineup right away
    setPanes(Object.fromEntries(selected.map((m) => [m.id, { status: "streaming", text: "" }])));

    const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
    const params: SharedParams = {
      temperature: num(temperature),
      top_p: num(topP),
      max_tokens: num(maxTokens),
    };

    try {
      await streamRun(
        { model_ids: selected.map((m) => m.id), prompt, system_prompt: systemPrompt, params },
        {
          onToken: (modelId, text) => {
            setPanes((prev) => {
              const pane = prev[modelId];
              if (!pane) return prev;
              return { ...prev, [modelId]: { ...pane, text: pane.text + text } };
            });
            autoScroll(modelId);
          },
          onDone: (modelId, result) => {
            setPanes((prev) =>
              prev[modelId] ? { ...prev, [modelId]: { ...prev[modelId], status: "done", usage: result } } : prev,
            );
          },
          onError: (modelId, message) => {
            if (!modelId) {
              // empty id = the whole run failed before any model streamed
              setBanner(message);
              return;
            }
            setPanes((prev) =>
              prev[modelId] ? { ...prev, [modelId]: { ...prev[modelId], status: "error", error: message } } : prev,
            );
          },
        },
      );
    } catch (err) {
      if (err instanceof RunConflictError) {
        setBanner(err.message + " " + err.conflicts.join(" "));
      } else {
        setBanner((err as Error).message);
      }
    } finally {
      setRunning(false);
    }
  }


  return (
    <div className="page-backdrop min-h-screen">
      {/* top bar */}
      <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-6">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">
            Æ
          </span>
          <span className="wordmark text-[15px] font-bold text-slate-900">AI Evals</span>
          <span className="ml-auto text-xs text-slate-400">
            Same prompt · same params · up to {MAX_MODELS} models side by side
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-16">
        {loadError && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {loadError} — check that the backend is running on port 8000 and reload.
          </div>
        )}

        {/* prompt + params card */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
          <p className="section-title mb-3">Models</p>
          <ModelPicker models={models} selected={selected} onAdd={(m) => setSelected((prev) => [...prev, m])} onRemove={(id) => setSelected((prev) => prev.filter((m) => m.id !== id))} />
          <p className="section-title mb-3 mt-5">Prompt</p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Ask every model the same thing…"
            className="w-full resize-y rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm leading-6 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
          />

          <p className="section-title mb-3 mt-5">System prompt</p>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={2}
            placeholder="Optional — sets the same persona or rules for every model."
            className="w-full resize-y rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm leading-6 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
          />

          <div className="mt-5 grid grid-cols-3 gap-4">
            <ParamField label="Temperature" value={temperature} onChange={setTemperature} step={0.1} min={0} max={2} {...temp} />
            <ParamField label="Top P" value={topP} onChange={setTopP} step={0.05} min={0} max={1} {...top} />
            <ParamField label="Max tokens" value={maxTokens} onChange={setMaxTokens} step={64} min={1} {...mt} />
          </div>

          {paramsBlocked && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              A highlighted parameter isn't supported by every selected model — clear it or remove that model to run.
            </p>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={handleRun}
              disabled={!canRun}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {running ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Running…
                </>
              ) : (
                "Run comparison"
              )}
            </button>
            <span className="text-xs text-slate-400">
              {selected.length === 0
                ? "Pick at least one model to enable the run"
                : `${selected.length} of ${MAX_MODELS} models selected`}
            </span>
          </div>
        </section>

        {banner && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{banner}</div>
        )}

        {/* results */}
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="section-title">Results</p>
            {selected.length > 0 && (
              <p className="text-xs text-slate-400">
                {running ? "Streaming…" : Object.keys(panes).length > 0 ? "Latest run" : "Ready"}
              </p>
            )}
          </div>
          {selected.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center">
              <p className="text-sm font-medium text-slate-500">No models selected</p>
              <p className="mt-1 text-xs text-slate-400">Use the picker above to choose up to {MAX_MODELS} models.</p>
            </div>
          ) : (
            <div
              className={`grid gap-4 ${
                selected.length === 1
                  ? "grid-cols-1"
                  : selected.length === 2
                    ? "grid-cols-1 md:grid-cols-2"
                    : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
              }`}
            >
              {selected.map((m) => (
                <OutputPane key={m.id} model={m} pane={panes[m.id]} scrollRef={(el) => setScrollRef(m.id, el)} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
