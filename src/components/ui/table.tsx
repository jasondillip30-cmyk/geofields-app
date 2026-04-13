import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface DataTableProps {
  columns: ReactNode[];
  rows: ReactNode[][];
  className?: string;
  onRowClick?: (rowIndex: number) => void;
  rowClassName?: string;
  rowClassNames?: string[];
  rowIds?: string[];
  stickyHeader?: boolean;
  compact?: boolean;
}

export function DataTable({
  columns,
  rows,
  className,
  onRowClick,
  rowClassName,
  rowClassNames,
  rowIds,
  stickyHeader = true,
  compact = false
}: DataTableProps) {
  const headerCellClassName = compact
    ? "px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
    : "px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500";
  const bodyCellClassName = compact
    ? "px-3 py-2 align-top text-xs text-ink-800"
    : "px-3 py-2.5 align-top text-xs text-ink-800";
  const columnLabels = columns.map((column, index) => toColumnLabel(column, index));

  return (
    <div
      className={cn(
        "max-w-full overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03),0_6px_14px_rgba(15,23,42,0.04)]",
        className
      )}
    >
      <div className="space-y-2 p-2 md:hidden">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-600">
            No rows available.
          </div>
        ) : (
          rows.map((row, rowIndex) => {
            const primaryCell = row[0];
            const secondaryCells = row.slice(1);
            return (
              <article
                key={`mobile-row-${rowIndex}`}
                id={rowIds?.[rowIndex]}
                onClick={onRowClick ? () => onRowClick(rowIndex) : undefined}
                className={cn(
                  "space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]",
                  onRowClick ? "cursor-pointer transition-colors hover:bg-brand-50/35" : "",
                  rowClassName,
                  rowClassNames?.[rowIndex]
                )}
              >
                <div className="text-sm font-semibold text-ink-900">{primaryCell}</div>
                {secondaryCells.length > 0 ? (
                  <dl className="space-y-1.5">
                    {secondaryCells.map((cell, secondaryIndex) => (
                      <div
                        key={`mobile-cell-${rowIndex}-${secondaryIndex + 1}`}
                        className="flex items-start justify-between gap-3"
                      >
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {columnLabels[secondaryIndex + 1] || `Column ${secondaryIndex + 2}`}
                        </dt>
                        <dd className="min-w-0 text-right text-xs text-ink-800">{cell}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left">
          <thead className={cn("border-b border-slate-200/85 bg-slate-50/90", stickyHeader && "sticky top-0 z-10")}>
            <tr>
              {columns.map((column, columnIndex) => (
                <th key={`column-${columnIndex}`} className={headerCellClassName}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white">
            {rows.map((row, rowIndex) => (
              <tr
                key={`row-${rowIndex}`}
                id={rowIds?.[rowIndex]}
                onClick={onRowClick ? () => onRowClick(rowIndex) : undefined}
                className={cn(
                  "border-b border-slate-100/85 transition-all duration-200 ease-out last:border-b-0",
                  onRowClick
                    ? "cursor-pointer hover:bg-brand-50/35"
                    : "hover:bg-slate-50/70",
                  rowClassName,
                  rowClassNames?.[rowIndex]
                )}
              >
                {row.map((cell, cellIndex) => (
                  <td
                    key={`cell-${rowIndex}-${cellIndex}`}
                    className={bodyCellClassName}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function toColumnLabel(column: ReactNode, index: number) {
  if (typeof column === "string") {
    return column;
  }
  if (typeof column === "number") {
    return String(column);
  }
  return `Column ${index + 1}`;
}
