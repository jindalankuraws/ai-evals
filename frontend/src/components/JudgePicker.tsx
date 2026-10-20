import type { ModelInfo } from "../api";
import { eligibleJudges } from "../lib/judge";
import Monogram from "./Monogram";

// Judge strip: auto-preselected on model pick (see lib/judge.ts), editable
// pre-run, locked at trigger. Eligibility mirrors the backend's judge gate —
// structured outputs + outside every compared model's family.
export default function JudgePicker({
  models,
  selectedIds,
  judgeId,
  onChange,
  disabled,
}: {
  models: ModelInfo[];
  selectedIds: string[];
  judgeId: string | null;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const eligible = eligibleJudges(models, selectedIds);
  const judge = judgeId ? models.find((m) => m.id === judgeId) ?? null : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      {eligible.length === 0 ? (
        <p className="text-xs text-slate-500">
          No eligible judge — pick at least one model from a different family that supports structured outputs.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          {judge && <Monogram model={judge} />}
          <select
            value={judgeId ?? ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            aria-label="Judge model"
          >
            {eligible.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.id}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-4 text-slate-400">
        {disabled
          ? "Locked for this run — a fresh run picks a new judge."
          : "Grades every response comparatively on five fixed metrics. Must sit outside the compared families."}
      </p>
    </div>
  );
}