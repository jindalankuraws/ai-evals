import type { ModelInfo } from "../api";
import { monogramColor, monogramOf } from "../lib/models";

// Small branded avatar for a model, colored by provider. Used in the picker
// rows, the selected chips, and each result pane header.
export default function Monogram({ model, size = "md" }: { model: ModelInfo; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "h-5 w-5 text-[9px]" : "h-7 w-7 text-[11px]";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-md font-semibold text-white ${cls}`}
      style={{ backgroundColor: monogramColor(model) }}
    >
      {monogramOf(model)}
    </span>
  );
}
