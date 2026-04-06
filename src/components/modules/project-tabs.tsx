"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type ProjectTabKey = "ledger" | "costs" | "revenue" | "operations";

interface ProjectTabsProps {
  ledger: ReactNode;
  costs: ReactNode;
  revenue: ReactNode;
  operations: ReactNode;
}

const TAB_OPTIONS: Array<{ key: ProjectTabKey; label: string }> = [
  { key: "ledger", label: "Ledger" },
  { key: "costs", label: "Costs" },
  { key: "revenue", label: "Revenue" },
  { key: "operations", label: "Operations" }
];

export function ProjectTabs({ ledger, costs, revenue, operations }: ProjectTabsProps) {
  const [activeTab, setActiveTab] = useState<ProjectTabKey | null>(null);

  return (
    <section id="project-tabs" className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap gap-2">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab((current) => (current === tab.key ? null : tab.key))}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                activeTab === tab.key
                  ? "border-brand-300 bg-brand-50 text-brand-800"
                  : "border-slate-200 bg-white text-ink-700 hover:bg-slate-50"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === null ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-ink-700">
          Select a tab to open project details.
        </p>
      ) : null}

      {activeTab === "ledger" ? <div className="space-y-4">{ledger}</div> : null}
      {activeTab === "costs" ? <div className="space-y-4">{costs}</div> : null}
      {activeTab === "revenue" ? <div className="space-y-4">{revenue}</div> : null}
      {activeTab === "operations" ? <div className="space-y-4">{operations}</div> : null}
    </section>
  );
}
