import { formatCurrency } from "@/lib/utils";
import { formatTransactionGroupDate } from "./spending-page-utils";
import type { SpendingTransactionRow } from "./spending-page-types";

export function GroupRows({
  groupDate,
  rows,
  onRowClick
}: {
  groupDate: string;
  rows: SpendingTransactionRow[];
  onRowClick: (row: SpendingTransactionRow) => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={3} className="bg-slate-50/75 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {formatTransactionGroupDate(groupDate)}
        </td>
      </tr>
      {rows.map((row) => (
        <tr
          key={row.id}
          onClick={() => onRowClick(row)}
          className="cursor-pointer border-b border-slate-100/85 transition-colors hover:bg-brand-50/35 last:border-b-0"
        >
          <td className="px-3 py-2.5 text-sm font-medium text-ink-900">{row.merchant}</td>
          <td className="px-3 py-2.5 text-sm text-slate-700">{row.category}</td>
          <td className="px-3 py-2.5 text-right text-sm font-semibold text-ink-900">{formatCurrency(row.amount)}</td>
        </tr>
      ))}
    </>
  );
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm text-ink-900">{value}</p>
    </div>
  );
}
