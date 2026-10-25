// "unsupported" dims the field; "blocked" also has a value, so the run can't start
export default function ParamField({
  label,
  value,
  onChange,
  step,
  min,
  max,
  unsupported,
  blocked,
  missingNames,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step: number;
  min?: number;
  max?: number;
  unsupported: boolean;
  blocked: boolean;
  missingNames: string[];
}) {
  return (
    <label className={`block ${unsupported ? "opacity-50" : ""}`}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        placeholder="default"
        title={unsupported ? `Not supported by ${missingNames.join(", ")}` : undefined}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-slate-400 focus:ring-2 ${
          blocked
            ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
            : "border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/15"
        }`}
      />
    </label>
  );
}
