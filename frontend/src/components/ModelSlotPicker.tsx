import { useMemo, useState } from "react";
import type { ModelInfo } from "../api";
import Monogram from "./Monogram";

// The inference providers a slot can target, in the order they were chosen.
// Stage A ships with OpenRouter wired up; the other three light up as their
// adapters land in the backend work.
const PROVIDERS = [
  { id: "openai", label: "OpenAI", hint: "GPT models via OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", hint: "Claude models via ANTHROPIC_API_KEY" },
  { id: "openrouter", label: "OpenRouter", hint: "One key, hundreds of hosted models" },
  { id: "openai-compatible", label: "OpenAI-compatible", hint: "Self-hosted or local endpoints" },
] as const;

// One slot in the comparison grid. An empty slot opens a two-step picker:
// pick an inference provider first, then a model within it. The model step
// shows full names only — no pricing or context noise.
export default function ModelSlotPicker({
  models,
  takenIds,
  onPick,
  disabled,
}: {
  models: ModelInfo[];
  takenIds: string[];
  onPick: (model: ModelInfo) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // null → provider step, otherwise the chosen provider id
  const [provider, setProvider] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Stage A: the backend catalog is OpenRouter-only, so every model belongs
  // to OpenRouter and the other providers have no listings yet.
  const modelsFor = (id: string): ModelInfo[] => (id === "openrouter" ? models : []);

  // how many models each provider can offer right now
  const counts = useMemo(
    () => new Map(PROVIDERS.map((p) => [p.id, modelsFor(p.id).length])),
    [models],
  );

  const q = query.trim().toLowerCase();
  const shownModels = useMemo(
    () =>
      provider
        ? modelsFor(provider).filter(
            (m) => q === "" || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
          )
        : [],
    [provider, models, q],
  );

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          setProvider(null);
          setQuery("");
        }}
        className="flex min-h-[18rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-10 text-center transition-colors hover:border-indigo-400 hover:bg-indigo-50/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="text-lg leading-none text-slate-300">＋</span>
        <span className="text-sm font-medium text-slate-500">Select a model</span>
        <span className="text-xs text-slate-400">Pick a provider, then a model</span>
      </button>
    );
  }

  return (
    <div className="flex min-h-[18rem] flex-col overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-xs">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={provider === null ? "Filter providers…" : "Filter by model name…"}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none transition-colors focus:border-indigo-500 focus:bg-white"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="Close"
          aria-label="Close picker"
          className="shrink-0 cursor-pointer rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          ✕
        </button>
      </div>

      <div className="scroll-slim flex-1 overflow-y-auto p-1.5">

        {/* step 2 — full model names of the chosen provider */}
        {provider !== null && (
          <>
            <button
              type="button"
              onClick={() => {
                setProvider(null);
                setQuery("");
              }}
              className="mb-1 w-full cursor-pointer rounded-lg px-3 py-1.5 text-left text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50"
            >
              ← Back to providers
            </button>
            {shownModels.map((m) => {
              const taken = takenIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={taken}
                  onClick={() => {
                    onPick(m);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    taken ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-indigo-50"
                  }`}
                >
                  <Monogram model={m} />
                  <span className="min-w-0 flex-1 break-words pt-0.5 text-sm leading-5 text-slate-900">
                    {m.name}
                  </span>
                  {taken && (
                    <span className="shrink-0 pt-1 text-[11px] text-slate-400">already picked</span>
                  )}
                </button>
              );
            })}
            {shownModels.length === 0 && (
              <p className="px-3 py-8 text-center text-xs text-slate-400">
                {q ? `No models match “${query}”.` : "No models available for this provider yet."}
              </p>
            )}
          </>
        )}

        {/* step 1 — the inference providers, fixed list */}
        {provider === null && (
          <>
            {PROVIDERS.filter((p) => q === "" || p.label.toLowerCase().includes(q)).map((p) => {
              const count = counts.get(p.id) ?? 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={count === 0}
                  onClick={() => {
                    setProvider(p.id);
                    setQuery("");
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                    count === 0 ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-slate-100"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-700">{p.label}</span>
                    <span className="block truncate text-[11px] text-slate-400">{p.hint}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {count === 0 ? "not wired up yet" : `${count} models`}
                  </span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
