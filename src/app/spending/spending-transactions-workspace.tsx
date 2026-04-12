"use client";

import { RotateCw, Search } from "lucide-react";

import { Card } from "@/components/ui/card";
import { GroupRows } from "./spending-page-table-parts";
import type { SpendingTransactionRow, SpendingTransactionsPayload } from "./spending-page-types";

interface SpendingTransactionsWorkspaceProps {
  transactionsLoading: boolean;
  transactionsRefreshing: boolean;
  transactions: SpendingTransactionsPayload;
  transactionCategoryFilter: string;
  transactionSearch: string;
  transactionGroups: Array<{ date: string; rows: SpendingTransactionRow[] }>;
  onRefresh: () => void;
  onTransactionCategoryFilterChange: (value: string) => void;
  onTransactionSearchChange: (value: string) => void;
  onTransactionRowClick: (row: SpendingTransactionRow) => void;
}

export function SpendingTransactionsWorkspace({
  transactionsLoading,
  transactionsRefreshing,
  transactions,
  transactionCategoryFilter,
  transactionSearch,
  transactionGroups,
  onRefresh,
  onTransactionCategoryFilterChange,
  onTransactionSearchChange,
  onTransactionRowClick
}: SpendingTransactionsWorkspaceProps) {
  return (
    <Card
      title="Transactions"
      subtitle="Completed live project purchases from requisition to receipt posting."
      action={
        <button type="button" onClick={onRefresh} className="gf-btn-subtle inline-flex items-center gap-1">
          <RotateCw size={13} className={transactionsRefreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-1">
              <select
                value={transactionCategoryFilter}
                onChange={(event) => {
                  onTransactionCategoryFilterChange(event.target.value);
                }}
                className="rounded-full border-none bg-transparent px-2 py-0.5 text-sm text-ink-900 focus:outline-none"
              >
                <option value="all">All categories</option>
                {transactions.categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600">
            <Search size={14} />
            <input
              value={transactionSearch}
              onChange={(event) => onTransactionSearchChange(event.target.value)}
              placeholder="Search merchant"
              className="w-44 border-none bg-transparent text-sm text-ink-900 placeholder:text-slate-400 focus:outline-none"
            />
          </label>
        </div>

        {transactionsLoading ? (
          <p className="text-sm text-slate-600">Loading transactions...</p>
        ) : transactionGroups.length === 0 ? (
          <p className="text-sm text-slate-600">No transactions found for this scope.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200/85 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03),0_6px_14px_rgba(15,23,42,0.04)]">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="border-b border-slate-200/85 bg-slate-50/90">
                  <tr>
                    <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Merchant
                    </th>
                    <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Category
                    </th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transactionGroups.map((group) => (
                    <GroupRows
                      key={group.date}
                      groupDate={group.date}
                      rows={group.rows}
                      onRowClick={onTransactionRowClick}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
