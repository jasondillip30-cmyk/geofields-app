"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";

import { AiCopilotProvider } from "@/components/layout/ai-copilot-context";
import { AnalyticsFiltersProvider } from "@/components/layout/analytics-filters-provider";
import { CopilotActionContextToast } from "@/components/layout/copilot-action-context-toast";
import { GlobalAiCopilot } from "@/components/layout/global-ai-copilot";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

const SIDEBAR_HIDDEN_STORAGE_KEY = "gf:sidebar-hidden";

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarHidden, setSidebarHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.sessionStorage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY);
    setSidebarHidden(raw === "1");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.sessionStorage.setItem(SIDEBAR_HIDDEN_STORAGE_KEY, sidebarHidden ? "1" : "0");
  }, [sidebarHidden]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-app-gradient">
      <AnalyticsFiltersProvider>
        <AiCopilotProvider>
          <div className="flex min-h-screen flex-col lg:h-screen lg:min-h-0 lg:flex-row lg:overflow-hidden">
            <Suspense fallback={<div className="hidden w-72 border-r border-slate-200 bg-white lg:block" />}>
              <Sidebar sidebarHidden={sidebarHidden} />
            </Suspense>
            <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:min-h-0 lg:overflow-hidden">
              <Topbar sidebarHidden={sidebarHidden} onToggleSidebar={() => setSidebarHidden((current) => !current)} />
              <main className="flex-1 min-w-0 overflow-x-hidden px-4 py-5 md:px-6 md:py-6 lg:overflow-y-auto lg:px-7 lg:py-7">
                <div className="mx-auto w-full min-w-0 max-w-[1720px] [&>*]:min-w-0">{children}</div>
              </main>
            </div>
          </div>
          <GlobalAiCopilot />
          <CopilotActionContextToast />
        </AiCopilotProvider>
      </AnalyticsFiltersProvider>
    </div>
  );
}
