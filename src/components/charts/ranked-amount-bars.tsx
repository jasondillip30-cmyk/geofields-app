import { formatCurrency } from "@/lib/utils";

type AmountRow = { id: string; label: string; amount: number };

export function RankedAmountBars({ rows, label, limit, signed = false, positive = "Amounts", negative = "Credits and reversals" }: {
  rows: AmountRow[];
  label: string;
  limit?: number;
  signed?: boolean;
  positive?: string;
  negative?: string;
}) {
  const ranked = [...rows].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const visible = ranked.slice(0, limit);
  const maximum = Math.abs(ranked[0]?.amount ?? 0);
  const split = signed || ranked.some(({ amount }) => amount < 0);

  return (
    <>
      {(split || visible.length < rows.length) && (
        <p className="mb-3 text-xs text-ink-600">
          {visible.length < rows.length && `Showing ${visible.length} of ${rows.length} by largest absolute amount. `}
          {split && `${positive} extend right; ${negative.toLowerCase()} extend left.`}
        </p>
      )}
      <ul className="space-y-3" aria-label={label}>
        {visible.map(({ id, label: rowLabel, amount }) => (
          <li key={id}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm text-ink-800">
              <span className="min-w-0 break-words">{rowLabel}</span>
              <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(amount)}</span>
            </div>
            <div aria-hidden="true" className="relative h-2 rounded-full bg-slate-100">
              {split && <span className="absolute inset-y-0 left-1/2 z-10 w-px bg-slate-400" />}
              <span
                className={`absolute inset-y-0 rounded-full ${amount < 0 ? "right-1/2 bg-rose-600" : split ? "left-1/2 bg-brand-600" : "left-0 bg-brand-600"}`}
                style={{ width: maximum > 0 ? `${Math.abs(amount) / maximum * (split ? 50 : 100)}%` : "0%" }}
              />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
