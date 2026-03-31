"use client";

import { AlertTriangle, CheckCircle2, CircleHelp, ClipboardCheck, Lightbulb, ListChecks } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type WorkflowAssistTone = "indigo" | "amber" | "emerald" | "slate";

export interface WorkflowAssistModel {
  heading: string;
  roleLabel?: string | null;
  whyThisMatters: string;
  inspectFirst: string[];
  missingContext?: string[];
  recommendedNextStep?: string | null;
  checklist?: string[];
  tone?: WorkflowAssistTone;
}

export function WorkflowAssistPanel({
  model,
  className
}: {
  model: WorkflowAssistModel | null;
  className?: string;
}) {
  if (!model) {
    return null;
  }

  const toneClass = resolveToneClass(model.tone || "indigo");
  const rolePresentation = resolveRolePresentation(model.roleLabel || null);

  return (
    <Card className={cn("relative overflow-hidden p-4 md:p-5", className)}>
      <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-1.5", rolePresentation.topAccent)} />
      <div className={cn("rounded-xl border px-4 py-3.5", toneClass.wrapper)}>
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <p className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]", toneClass.heading)}>
            <Lightbulb size={13} />
            {model.heading}
          </p>
          {model.roleLabel ? (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                toneClass.badge,
                rolePresentation.badgeAccent
              )}
            >
              {model.roleLabel}
            </span>
          ) : null}
        </div>

        <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
          <section className={cn("rounded-lg border bg-white/65 px-3 py-2.5", toneClass.innerPanel)}>
            <p className={cn("text-[11px] font-semibold uppercase tracking-wide", toneClass.subheading)}>Why This Matters</p>
            <p className={cn("mt-1.5 text-sm leading-5", toneClass.body)}>{model.whyThisMatters}</p>
          </section>

          {model.inspectFirst.length > 0 ? (
            <section className={cn("rounded-lg border bg-white/65 px-3 py-2.5", toneClass.innerPanel)}>
              <p className={cn("inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide", toneClass.subheading)}>
                <CircleHelp size={12} />
                Inspect first
              </p>
              <ul className="mt-1.5 space-y-1">
                {model.inspectFirst.slice(0, 4).map((entry) => (
                  <li key={entry} className={cn("text-xs leading-5", toneClass.body)}>
                    • {entry}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {model.missingContext && model.missingContext.length > 0 ? (
          <section className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50/75 px-3 py-2.5">
            <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              <AlertTriangle size={12} />
              Missing context
            </p>
            <ul className="mt-1.5 space-y-1">
              {model.missingContext.slice(0, 3).map((entry) => (
                <li key={entry} className="text-xs leading-5 text-amber-900">
                  • {entry}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {model.checklist && model.checklist.length > 0 ? (
          <section className={cn("mt-2.5 rounded-lg border bg-white/65 px-3 py-2.5", toneClass.innerPanel)}>
            <p className={cn("inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide", toneClass.subheading)}>
              <ListChecks size={12} />
              Review checklist
            </p>
            <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              {model.checklist.slice(0, 6).map((entry) => (
                <li key={entry} className={cn("inline-flex items-start gap-1.5 text-xs leading-5", toneClass.body)}>
                  <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                  <span>{entry}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {model.recommendedNextStep ? (
          <p className={cn("mt-2.5 inline-flex items-start gap-1.5 rounded-lg border bg-white/70 px-3 py-2 text-xs", toneClass.innerPanel, toneClass.body)}>
            <ClipboardCheck size={12} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold">Recommended next step:</span> {model.recommendedNextStep}
            </span>
          </p>
        ) : null}

        {rolePresentation.helperText ? (
          <p className={cn("mt-2 text-[11px]", rolePresentation.helperTextClass)}>
            {rolePresentation.helperText}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function resolveRolePresentation(roleLabel: string | null) {
  const normalized = (roleLabel || "").toLowerCase();
  if (/manager|admin|executive/.test(normalized)) {
    return {
      topAccent: "bg-gradient-to-r from-indigo-500/80 via-brand-500/80 to-cyan-500/70",
      badgeAccent: "ring-1 ring-indigo-100",
      helperText: "Decision lens: prioritize impact, queue risk, and profitability implications first.",
      helperTextClass: "text-indigo-700"
    };
  }
  if (/office|approval|review|linkage/.test(normalized)) {
    return {
      topAccent: "bg-gradient-to-r from-sky-500/75 via-brand-500/75 to-indigo-500/65",
      badgeAccent: "ring-1 ring-sky-100",
      helperText: "Review lens: complete missing context and close approval-ready records efficiently.",
      helperTextClass: "text-sky-700"
    };
  }
  if (/mechanic|workshop|maintenance/.test(normalized)) {
    return {
      topAccent: "bg-gradient-to-r from-amber-500/80 via-orange-500/75 to-emerald-500/65",
      badgeAccent: "ring-1 ring-amber-100",
      helperText: "Workshop lens: validate urgency, downtime impact, and parts readiness before acting.",
      helperTextClass: "text-amber-700"
    };
  }
  if (/field|operations|report/.test(normalized)) {
    return {
      topAccent: "bg-gradient-to-r from-emerald-500/70 via-teal-500/70 to-sky-500/65",
      badgeAccent: "ring-1 ring-emerald-100",
      helperText: "Reporting lens: close completeness gaps and submission delays for clean operational visibility.",
      helperTextClass: "text-emerald-700"
    };
  }
  return {
    topAccent: "bg-gradient-to-r from-slate-400/60 via-slate-500/60 to-slate-400/55",
    badgeAccent: "",
    helperText: null,
    helperTextClass: "text-slate-600"
  };
}

function resolveToneClass(tone: WorkflowAssistTone) {
  if (tone === "amber") {
    return {
      wrapper: "border-amber-200 bg-amber-50/55",
      innerPanel: "border-amber-200/80",
      heading: "text-amber-700",
      subheading: "text-amber-700",
      body: "text-amber-900",
      badge: "border-amber-300 bg-white text-amber-700"
    };
  }
  if (tone === "emerald") {
    return {
      wrapper: "border-emerald-200 bg-emerald-50/50",
      innerPanel: "border-emerald-200/80",
      heading: "text-emerald-700",
      subheading: "text-emerald-700",
      body: "text-emerald-900",
      badge: "border-emerald-300 bg-white text-emerald-700"
    };
  }
  if (tone === "slate") {
    return {
      wrapper: "border-slate-200 bg-slate-50/80",
      innerPanel: "border-slate-200/80",
      heading: "text-slate-700",
      subheading: "text-slate-700",
      body: "text-slate-800",
      badge: "border-slate-300 bg-white text-slate-700"
    };
  }
  return {
    wrapper: "border-indigo-200 bg-indigo-50/60",
    innerPanel: "border-indigo-200/80",
    heading: "text-indigo-700",
    subheading: "text-indigo-700",
    body: "text-indigo-900",
    badge: "border-indigo-300 bg-white text-indigo-700"
  };
}
