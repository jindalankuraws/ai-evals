import { useMemo, useState } from "react";
import type { ModelInfo, ProviderFetchStatus, ProviderInfo } from "../api";
import Monogram from "./Monogram";

// two-step picker: a provider first, then one of its models
export default function ModelSlotPicker({
  models,
  providers,
  providerStatus,
  takenIds,
  onPick,
  disabled,
}: {
  models: ModelInfo[];
  providers: ProviderInfo[];
  providerStatus: Record<string, ProviderFetchStatus>;
  takenIds: string[];
  onPick: (model: ModelInfo) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // null → provider step, otherwise the chosen provider slug
  const [provider, setProvider] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // models of the chosen provider, straight from the merged catalog
  const modelsFor = useMemo(() => {
    const byProvider = new Map<string, ModelInfo[]>();
    for (const m of models) {
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }
    return (slug: string) => byProvider.get(slug) ?? [];
  }, [models]);

  // how many models each provider can offer right now
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of providers) map.set(p.slug, modelsFor(p.slug).length);
    return map;
  }, [providers, modelsFor]);

  const q = query.trim().toLowerCase();
  const shownModels = useMemo(
    () =>
      provider
        ? modelsFor(provider).filter(
            (m) => q === "" || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
          )
        : [],
    [provider, modelsFor, q],
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

        {/* step 2: models of the chosen provider */}
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
                {q
                  ? `No models match “${query}”.`
                  : providerStatus[provider]?.error ?? "No models available for this provider yet."}
              </p>
            )}
          </>
        )}

        {/* step 1: providers from /api/providers */}
        {provider === null && (
          <>
            {providers
              .filter((p) => q === "" || p.label.toLowerCase().includes(q))
              .map((p) => {
                const count = counts.get(p.slug) ?? 0;
                // unconfigured: grayed out, with the env key the user must add.
                // configured but empty: surface the fetch failure, never a bare
                // "no models" for a provider that should have models
                const hint = p.configured
                  ? p.hint
                  : `add ${p.api_key_env} to backend/.env`;
                const status = providerStatus[p.slug];
                // a provider earns its selectable state from a successful
                // fetch, not just from having a key in the env
                const selectable = p.configured && status?.state === "ok";
                const stateLabel = !p.configured
                  ? "not set up"
                  : status?.state === "failed"
                    ? status?.error ?? "no models"
                    : `${count} models`;
                return (
                  <button
                    key={p.slug}
                    type="button"
                    disabled={!selectable}
                    onClick={() => {
                      setProvider(p.slug);
                      setQuery("");
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                      selectable
                        ? "cursor-pointer hover:bg-slate-100"
                        : "cursor-not-allowed opacity-50"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-700">{p.label}</span>
                      <span className="block truncate text-[11px] text-slate-400">{hint}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-400">{stateLabel}</span>
                  </button>
                );
              })}
          </>
        )}
      </div>
    </div>
  );
}
