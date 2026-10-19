import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "../api";
import Monogram from "./Monogram";
import { MAX_MODELS, formatContext, pricingLabel } from "../lib/models";

// Multi-select model picker: a searchable dropdown with pricing and context
// info per row, plus removable chips for everything currently selected.
export default function ModelPicker({
  models,
  selected,
  onAdd,
  onRemove,
  disabled,
}: {
  models: ModelInfo[];
  selected: ModelInfo[];
  onAdd: (model: ModelInfo) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // close the dropdown on outside clicks and Escape
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const atCap = selected.length >= MAX_MODELS;
  const selectedIds = new Set(selected.map((m) => m.id));
  const q = query.trim().toLowerCase();
  const matches = models
    .filter((m) => (m.name + " " + m.id).toLowerCase().includes(q))
    .slice(0, 40);

  return (
    <div ref={boxRef}>
      <div className="relative">
        <button
          type="button"
          disabled={disabled || atCap}
          onClick={() => setOpen((o) => !o)}
          className={`flex w-full items-center justify-between rounded-xl border bg-white px-3.5 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            open
              ? "border-indigo-500 ring-2 ring-indigo-500/15"
              : "border-slate-300 hover:border-slate-400"
          }`}
        >
          <span className={selected.length === 0 ? "text-slate-400" : "font-medium text-slate-800"}>
            {atCap
              ? `Maximum reached — ${MAX_MODELS} of ${MAX_MODELS} selected`
              : selected.length === 0
                ? "Search or pick models to compare…"
                : `${selected.length} model${selected.length > 1 ? "s" : ""} selected — click to change`}
          </span>
          <svg
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {open && (
          <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3.5">
              <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path
                  fillRule="evenodd"
                  d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.45 4.39l3.08 3.08a.75.75 0 1 1-1.06 1.06l-3.08-3.08A7 7 0 0 1 2 9Z"
                  clipRule="evenodd"
                />
              </svg>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by name or id…"
                className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            <ul className="scroll-slim max-h-72 overflow-y-auto p-1.5">
              {matches.map((m) => {
                const picked = selectedIds.has(m.id);
                const price = pricingLabel(m);
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
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                        picked ? "cursor-not-allowed bg-slate-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <Monogram model={m} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">{m.name}</span>
                        <span className="block truncate text-xs text-slate-400">{m.id}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        {price && <span className="block text-xs font-medium text-slate-600">{price}</span>}
                        <span className="block text-xs text-slate-400">{formatContext(m.context_length)}</span>
                      </span>
                      {picked && (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                          added
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
              {matches.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-slate-400">No models match “{query}”</li>
              )}
            </ul>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {selected.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white py-1 pl-1.5 pr-1.5 text-xs font-medium text-slate-700 shadow-xs"
            >
              <Monogram model={m} size="sm" />
              <span className="max-w-52 truncate">{m.name}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(m.id)}
                className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
                title="Remove model"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
