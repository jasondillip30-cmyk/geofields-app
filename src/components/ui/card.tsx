import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

interface CardProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  onClick?: () => void;
  clickLabel?: string;
}

export function Card({ title, subtitle, children, className, action, onClick, clickLabel }: CardProps) {
  const interactive = Boolean(onClick);

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (!onClick) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, [data-card-ignore-click='true']")) {
      return;
    }
    onClick();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onClick) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onClick();
  };

  return (
    <section
      className={cn(
        "min-w-0 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_24px_rgba(15,23,42,0.05)] md:p-5 lg:p-6",
        interactive &&
          "group cursor-pointer transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-brand-200/80 hover:shadow-[0_4px_14px_rgba(15,23,42,0.08),0_18px_30px_rgba(15,23,42,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
        className
      )}
      onClick={interactive ? handleClick : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? clickLabel || (title ? `${title} details` : "View details") : undefined}
    >
      {(title || subtitle || action) && (
        <div className="mb-4 flex items-start justify-between gap-4 border-b border-slate-100 pb-3.5">
          <div className="min-w-0">
            {title && <h3 className="text-[15px] font-semibold tracking-tight text-ink-900 sm:text-base">{title}</h3>}
            {subtitle && <p className="mt-1 text-sm leading-5 text-slate-600">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  change?: string;
  tone?: "neutral" | "good" | "warn" | "danger";
  href?: string;
  disabled?: boolean;
  ctaLabel?: string;
  ctaVariant?: "label" | "icon" | "none";
}

const toneClass: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  neutral: "text-ink-700",
  good: "text-emerald-700",
  warn: "text-amber-700",
  danger: "text-red-700"
};

export function MetricCard({
  label,
  value,
  change,
  tone = "neutral",
  href,
  disabled = false,
  ctaLabel = "View details",
  ctaVariant = "icon"
}: MetricCardProps) {
  const interactive = Boolean(href) && !disabled;
  const content = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-ink-900">{value}</p>
      {change && <p className={cn("mt-2 text-sm font-medium", toneClass[tone])}>{change}</p>}
      {!interactive && href && (
        <p className={cn("mt-3 text-xs font-medium", interactive ? "text-brand-700" : "text-slate-400")}>
          Unavailable
        </p>
      )}
      {interactive && href && ctaVariant === "label" && (
        <p className="mt-3 text-xs font-medium text-brand-700">{`${ctaLabel} →`}</p>
      )}
      {interactive && href && ctaVariant === "none" && <span className="sr-only">{ctaLabel}</span>}
    </>
  );

  if (interactive && href) {
    return (
      <Link
        href={href}
        className="group relative block cursor-pointer rounded-xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_8px_18px_rgba(15,23,42,0.05)] transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-brand-200 hover:shadow-[0_4px_14px_rgba(15,23,42,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 sm:p-5"
      >
        {ctaVariant === "icon" && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute right-3 top-3 text-sm text-brand-500/70 transition-colors transition-opacity duration-200 group-hover:text-brand-700 group-hover:opacity-100"
            >
              ↗
            </span>
            <span className="sr-only">{ctaLabel}</span>
          </>
        )}
        {content}
      </Link>
    );
  }

  return (
    <div className={cn("rounded-xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-5", href && "opacity-75")}>
      {content}
    </div>
  );
}
