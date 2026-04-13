"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageActionBarProps {
  children: ReactNode;
  className?: string;
}

export function PageActionBar({ children, className }: PageActionBarProps) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 py-2 shadow-[0_-6px_18px_rgba(15,23,42,0.14)] backdrop-blur lg:hidden",
        className
      )}
    >
      <div className="mx-auto flex w-full max-w-[1720px] items-center justify-end gap-2">{children}</div>
    </div>
  );
}
