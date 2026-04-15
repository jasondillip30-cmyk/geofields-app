"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";

const plainRoutes = ["/login", "/unauthorized", "/workspace-launch"];

export function RootFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const normalizedPathname = normalizeAuthPathname(pathname);
  const isPlainRoute = plainRoutes.some(
    (route) => normalizedPathname === route || normalizedPathname.startsWith(`${route}/`)
  );

  if (isPlainRoute) {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}

function normalizeAuthPathname(pathname: string) {
  return pathname.replace(/^\/(login|unauthorized|workspace-launch)\.+(?=\/|$)/i, (_, segment: string) => {
    return `/${segment.toLowerCase()}`;
  });
}
