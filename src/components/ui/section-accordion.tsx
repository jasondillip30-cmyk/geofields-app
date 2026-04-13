"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

interface SectionAccordionProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export function SectionAccordion({
  title,
  subtitle,
  children,
  defaultOpen = false,
  className
}: SectionAccordionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink-900">{title}</span>
          {subtitle ? <span className="mt-0.5 block text-xs text-slate-600">{subtitle}</span> : null}
        </span>
        <span className="mt-0.5 text-slate-500">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>
      {open ? <div className="border-t border-slate-100 px-3 py-3">{children}</div> : null}
    </section>
  );
}
