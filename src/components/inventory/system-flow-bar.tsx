"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

type SystemFlowStage = "movement" | "issue" | "expense" | "profit";

interface SystemFlowBarProps {
  current: SystemFlowStage;
  className?: string;
}

const stages: Array<{ key: SystemFlowStage; label: string; href: string }> = [
  { key: "movement", label: "Movement", href: "/inventory/stock-movements" },
  { key: "issue", label: "Issue", href: "/inventory/issues" },
  { key: "expense", label: "Expense", href: "/inventory/expenses" },
  { key: "profit", label: "Profit", href: "/spending/profit" }
];

export function SystemFlowBar({ current, className }: SystemFlowBarProps) {
  return (
    <nav aria-label="System flow" className={cn("inline-flex items-center gap-1.5 text-[11px]", className)}>
      {stages.map((stage, index) => {
        const isActive = stage.key === current;
        return (
          <span key={stage.key} className="inline-flex items-center gap-1.5">
            {index > 0 ? <span className="text-slate-400">→</span> : null}
            <Link
              href={stage.href}
              className={cn(
                "rounded-full px-2 py-0.5 transition-colors",
                isActive
                  ? "border border-brand-300 bg-brand-50 font-semibold text-brand-900"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              )}
            >
              {stage.label}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}

