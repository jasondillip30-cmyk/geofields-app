"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";

const plainRoutes = ["/login", "/unauthorized"];

export function RootFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPlainRoute = plainRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));

  if (isPlainRoute) {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}
