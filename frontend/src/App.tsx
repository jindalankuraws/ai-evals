import { useCallback, useEffect, useRef, useState } from "react";
import {
  evaluateRun,
  fetchModels,
  streamRun,
  RunConflictError,
  type EvaluationResult,
  type ModelInfo,
  type SharedParams,
} from "./api";
import JudgePicker from "./components/JudgePicker";
import ModelPicker from "./components/ModelPicker";
import OutputPane, { type PaneState } from "./components/OutputPane";
import ParamField from "./components/ParamField";
import { MAX_MODELS } from "./lib/models";
import { eligibleJudges, pickJudge } from "./lib/judge";

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

  // judge + evaluation — the judge is bound to the run at trigger time and
  // the evaluate call fires exactly once when the stream ends (fire-once on
  // the backend, so a StrictMode double-invoke can't re-spend tokens)
  const [judgeId, setJudgeId] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [evalNote, setEvalNote] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);

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

  // auto-preselect the judge whenever the lineup changes — eligibility depends
  // on the compared families, so a manual pick survives only while it stays
  // eligible. Locked while a run or evaluation is in flight.
  const locked = running || evaluating;
  useEffect(() => {
    if (locked) return;
    const ids = selected.map((m) => m.id);
    if (!judgeId || !eligibleJudges(models, ids).some((m) => m.id === judgeId)) {
      setJudgeId(pickJudge(models, ids)?.id ?? null);
    }
  }, [models, selected, judgeId, locked]);

  // a shared param is unsupported when any selected model lacks it, and
  // "blocked" once it also holds a value — the run stays gated until then.
  // `missing` keeps the offender names so the warning can point at them.
  const paramState = (name: keyof SharedParams) => {
    const missing = selected.filter((m) => !m.supported_parameters.includes(name));
    const value = name === "temperature" ? temperature : name === "top_p" ? topP : maxTokens;
    return { unsupported: missing.length > 0, blocked: missing.length > 0 && value.trim() !== "", missing };
  };

  const temp = paramState("temperature");
  const top = paramState("top_p");
  const mt = paramState("max_tokens");
  const paramsBlocked = temp.blocked || top.blocked || mt.blocked;
  const blockedParams = [temp, top, mt].filter((p) => p.blocked);

  // "A and B" / "A, B, and C" — matches how the model chips read out names
  function joinNames(names: string[]): string {
    if (names.length <= 1) return names[0] ?? "";
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  }

  const canRun =
    selected.length > 0 && prompt.trim() !== "" && !running && !paramsBlocked && judgeId !== null;

  const autoScroll = (modelId: string) => {
    const el = scrollRefs.current.get(modelId);
    if (el) el.scrollTop = el.scrollHeight;
  };

  // auto-evaluate exactly once per run — fired when the stream settles, with
  // the run_id captured from the opening `run` event. Fire-once on the
  // backend, so an accidental repeat returns the cached verdict.
  async function autoEvaluate(runId: string) {
    setEvaluating(true);
    setEvalNote(null);
    try {
      const result = await evaluateRun(runId);
      setEvaluation(result);
      const failed = Object.values(result.metrics).filter((m) => m.status === "inference_error");
      if (failed.length > 0) {
        setEvalNote(
          `Partial evaluation — ${failed.map((m) => m.label).join(", ")} could not be scored` +
            ` (${failed.map((m) => m.error ?? "judge error").join("; ")}). The overall is weight-averaged over the scored metrics.`,
        );
      }
    } catch (err) {
      setEvalNote(`Evaluation failed — ${(err as Error).message} A fresh run is the only path.`);
    } finally {
      setEvaluating(false);
    }
  }

  async function handleRun() {
    if (!canRun || !judgeId) return;
    setRunning(true);
    setBanner(null);
    setEvaluation(null);
    setEvalNote(null);
    runIdRef.current = null;
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
        {
          model_ids: selected.map((m) => m.id),
          prompt,
          system_prompt: systemPrompt,
          params,
          judge_model: judgeId,
        },
        {
          onRunStart: (runId) => {
            runIdRef.current = runId;
          },
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
      // the stream has settled — the run is complete on the backend, so the
      // single evaluate call fires now (exactly once per run)
      if (runIdRef.current) void autoEvaluate(runIdRef.current);
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
            <ParamField label="Temperature" value={temperature} onChange={setTemperature} step={0.1} min={0} max={2} unsupported={temp.unsupported} blocked={temp.blocked} missingNames={temp.missing.map((m) => m.name)} />
            <ParamField label="Top P" value={topP} onChange={setTopP} step={0.05} min={0} max={1} unsupported={top.unsupported} blocked={top.blocked} missingNames={top.missing.map((m) => m.name)} />
            <ParamField label="Max tokens" value={maxTokens} onChange={setMaxTokens} step={64} min={1} unsupported={mt.unsupported} blocked={mt.blocked} missingNames={mt.missing.map((m) => m.name)} />
          </div>

          {paramsBlocked && (
            <div className="mt-3 space-y-1.5">
              {blockedParams.map((p) => {
                const names = p.missing.map((m) => m.name);
                const label =
                  p === temp ? "Temperature" : p === top ? "Top P" : "Max tokens";
                const who = names.length === 1 ? "that model" : "those models";
                return (
                  <p
                    key={label}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600"
                  >
                    {label} has a value, but {joinNames(names)}{" "}
                    {names.length === 1 ? "doesn't" : "don't"} support it — clear it or remove{" "}
                    {who} to run.
                  </p>
                );
              })}
            </div>
          )}

          <p className="section-title mb-3 mt-5">Judge</p>
          <JudgePicker
            models={models}
            selectedIds={selected.map((m) => m.id)}
            judgeId={judgeId}
            onChange={setJudgeId}
            disabled={locked}
          />

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={handleRun}
              disabled={!canRun || locked}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
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
                {running
                  ? "Streaming…"
                  : evaluating
                    ? "Evaluating responses…"
                    : evaluation
                      ? `Judged by ${evaluation.judge_model.split("/")[1] ?? evaluation.judge_model}`
                      : Object.keys(panes).length > 0
                        ? "Latest run"
                        : "Ready"}
              </p>
            )}
          </div>

          {/* judge banners — partial / failed / tie-break, no retry buttons */}
          {evalNote && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-5 text-amber-800">
              {evalNote}
            </div>
          )}
          {evaluation?.tie_break?.winner && (
            <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs leading-5 text-indigo-800">
              Tie at the 0.15 band — decided by a masked head-to-head: {evaluation.tie_break.rationale}
            </div>
          )}
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
              {selected.map((m) => {
                const entry = evaluation?.overall.find((o) => o.model_id === m.id);
                const metrics = evaluation
                  ? Object.values(evaluation.metrics)
                      .filter((metric) => metric.scores && metric.scores[m.id])
                      .map((metric) => ({
                        label: metric.label,
                        score: metric.scores![m.id].score,
                        normalized: metric.scores![m.id].normalized,
                        rationale: metric.scores![m.id].rationale,
                      }))
                  : null;
                return (
                  <OutputPane
                    key={m.id}
                    model={m}
                    pane={panes[m.id]}
                    scrollRef={(el) => setScrollRef(m.id, el)}
                    overall={entry ? entry.weighted_score : null}
                    letter={entry ? entry.letter : null}
                    isWinner={evaluation?.winner === m.id}
                    metrics={metrics}
                    evaluating={evaluating}
                  />
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
