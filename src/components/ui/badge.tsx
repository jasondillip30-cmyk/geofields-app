import { cn } from "@/lib/utils";

interface BadgeProps {
  children: string;
  tone?: "blue" | "green" | "amber" | "red" | "slate";
}

const toneStyles: Record<NonNullable<BadgeProps["tone"]>, string> = {
  blue: "border border-brand-200 bg-brand-50 text-brand-800",
  green: "border border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border border-amber-200 bg-amber-50 text-amber-800",
  red: "border border-red-200 bg-red-50 text-red-800",
  slate: "border border-slate-200 bg-slate-100 text-slate-700"
};

export function Badge({ children, tone = "slate" }: BadgeProps) {
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide", toneStyles[tone])}>
      {children}
    </span>
  );
}
