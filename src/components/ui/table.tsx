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
}

export function DataTable({
  columns,
  rows,
  className,
  onRowClick,
  rowClassName,
  rowClassNames,
  rowIds,
  stickyHeader = true
}: DataTableProps) {
  return (
    <div
      className={cn(
        "max-w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03),0_10px_22px_rgba(15,23,42,0.05)]",
        className
      )}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-left">
          <thead className={cn("border-b border-slate-200/85 bg-slate-50/90", stickyHeader && "sticky top-0 z-10")}>
            <tr>
              {columns.map((column, columnIndex) => (
                <th key={`column-${columnIndex}`} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
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
                    className="px-4 py-3 align-top text-[13px] text-ink-800"
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
