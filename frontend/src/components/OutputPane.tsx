import ReactMarkdown from "react-markdown";
import type { ModelInfo, RunResult } from "../api";
import Monogram from "./Monogram";
import { formatContext, pricingLabel, providerOf } from "../lib/models";

// Everything one pane knows about its model's run in the current comparison.
export interface PaneState {
  status: "streaming" | "done" | "error";
  text: string;
  usage?: RunResult;
  error?: string;
}

// one metric's score for this pane's model, as judged comparatively
export interface PaneMetric {
  label: string;
  score: number; // raw 1-5
  normalized: number; // 0-1
  rationale: string;
}

const STATUS = {
  streaming: {
    label: "Streaming",
    pill: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    dot: "animate-pulse bg-indigo-500",
  },
  done: {
    label: "Completed",
    pill: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  error: {
    label: "Failed",
    pill: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
  },
  idle: {
    label: "Waiting",
    pill: "bg-slate-100 text-slate-500 ring-slate-200",
    dot: "bg-slate-300",
  },
} as const;

function StatusPill({ status }: { status: keyof typeof STATUS }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${s.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// One side-by-side result card: branded header, streaming markdown body,
// styled failure card, judge scores (chips + rationales), and a usage footer
// once the model finishes. The winner's pane wears the ★ BEST badge.
export default function OutputPane({
  model,
  pane,
  scrollRef,
  overall,
  letter,
  isWinner,
  metrics,
  evaluating,
  onClear,
}: {
  model: ModelInfo;
  pane?: PaneState;
  scrollRef: (el: HTMLDivElement | null) => void;
  overall?: number | null;
  letter?: string | null;
  isWinner?: boolean;
  metrics?: PaneMetric[] | null;
  evaluating?: boolean;
  // removes this model from its comparison slot; hidden while streaming
  onClear?: () => void;
}) {
  const price = pricingLabel(model);
  return (
    <article
      className={`flex flex-col overflow-hidden rounded-xl bg-white shadow-xs ${
        isWinner ? "border-2 border-emerald-400" : "border border-slate-200"
      }`}
    >
      <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <Monogram model={model} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900" title={model.name}>
            {model.name}
            {letter ? <span className="ml-1.5 text-xs font-normal text-slate-400">({letter})</span> : null}
          </p>
          <p className="truncate text-xs text-slate-400">
            {providerOf(model)}
            {price ? ` · ${price}` : ""}
            {model.context_length ? ` · ${formatContext(model.context_length)}` : ""}
          </p>
        </div>
        {isWinner && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-300">
            ★ BEST
          </span>
        )}
        {overall !== null && overall !== undefined && (
          <span
            className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200"
            title="Weighted overall score (0–1)"
          >
            {overall.toFixed(2)}
          </span>
        )}
        {onClear && pane?.status !== "streaming" && (
          <button
            type="button"
            onClick={onClear}
            title="Remove this model from the comparison"
            aria-label={`Remove ${model.name}`}
            className="shrink-0 cursor-pointer rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        )}
        <StatusPill status={pane?.status ?? "idle"} />
      </header>

      <div
        ref={scrollRef}
        className={`scroll-slim prose prose-sm prose-slate max-w-none flex-1 overflow-y-auto px-4 py-3.5 text-sm leading-6 ${
          pane?.status === "streaming" ? "stream-caret" : ""
        }`}
        style={{ minHeight: "18rem", maxHeight: "36rem" }}
      >
        {pane === undefined ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-medium text-slate-500">Not run yet</p>
            <p className="text-xs text-slate-400">This pane fills in when the comparison starts.</p>
          </div>
        ) : pane.status === "error" ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
            <p className="mb-0.5 text-xs font-semibold text-red-700">This model failed</p>
            <p className="m-0 text-xs leading-5 text-red-600">{pane.error ?? "Something went wrong."}</p>
          </div>
        ) : (
          <ReactMarkdown>{pane.text}</ReactMarkdown>
        )}
      </div>

      {evaluating && pane?.status === "done" && (
        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-500">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />
          Judging this response…
        </div>
      )}

      {metrics && metrics.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Judge scores</p>
          <div className="flex flex-wrap gap-1.5">
            {metrics.map((metric) => (
              <span
                key={metric.label}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200"
                title={metric.rationale}
              >
                {metric.label}
                <span className="font-semibold text-slate-900">{metric.score}/5</span>
              </span>
            ))}
          </div>
          <div className="mt-2 space-y-1">
            {metrics.map((metric) => (
              <p key={`${metric.label}-rationale`} className="m-0 text-[11px] leading-4 text-slate-500">
                <span className="font-medium text-slate-600">{metric.label}:</span> {metric.rationale}
              </p>
            ))}
          </div>
        </div>
      )}

      {pane?.status === "done" && pane.usage && (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-xs text-slate-500">
          <span>{pane.usage.prompt_tokens ?? "–"} prompt tokens</span>
          <span aria-hidden>·</span>
          <span>{pane.usage.completion_tokens ?? "–"} completion tokens</span>
          {pane.usage.latency_ms ? (
            <>
              <span aria-hidden>·</span>
              <span>{(pane.usage.latency_ms / 1000).toFixed(1)}s</span>
            </>
          ) : null}
          {pane.usage.finish_reason ? (
            <>
              <span aria-hidden>·</span>
              <span>{pane.usage.finish_reason}</span>
            </>
          ) : null}
        </footer>
      )}
    </article>
  );
}
