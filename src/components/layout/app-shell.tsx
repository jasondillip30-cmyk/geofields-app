"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

import { AiCopilotProvider } from "@/components/layout/ai-copilot-context";
import { AnalyticsFiltersProvider } from "@/components/layout/analytics-filters-provider";
import { ChunkLoadRecovery } from "@/components/layout/chunk-load-recovery";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { WorkspaceModeRouteGuard } from "@/components/layout/workspace-mode-route-guard";
import { isAssistantExperienceEnabled } from "@/lib/feature-flags";

const SIDEBAR_HIDDEN_STORAGE_KEY = "gf:sidebar-hidden";
const GlobalAiCopilot = dynamic(
  () => import("@/components/layout/global-ai-copilot").then((module) => module.GlobalAiCopilot),
  { ssr: false }
);
const CopilotActionContextToast = dynamic(
  () =>
    import("@/components/layout/copilot-action-context-toast").then(
      (module) => module.CopilotActionContextToast
    ),
  { ssr: false }
);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const assistantExperienceEnabled = isAssistantExperienceEnabled();

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.gfHydrated = "1";
    return () => {
      delete document.documentElement.dataset.gfHydrated;
    };
  }, []);

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

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    if (!mobileSidebarOpen) {
      document.body.style.overflow = "";
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileSidebarOpen]);

  useEffect(() => {
    if (!mobileSidebarOpen || typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileSidebarOpen]);

  const handleSidebarToggle = () => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      setSidebarHidden((current) => !current);
      return;
    }
    setMobileSidebarOpen((current) => !current);
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-app-gradient">
      <AnalyticsFiltersProvider>
        <AiCopilotProvider>
          <ChunkLoadRecovery />
          {mobileSidebarOpen ? (
            <button
              type="button"
              className="fixed inset-0 z-30 bg-slate-900/45 backdrop-blur-[1px] lg:hidden"
              aria-label="Close navigation menu"
              onClick={() => setMobileSidebarOpen(false)}
            />
          ) : null}
          <div className="flex min-h-screen flex-col lg:h-screen lg:min-h-0 lg:flex-row lg:overflow-hidden">
            <Suspense fallback={<div className="hidden w-72 border-r border-slate-200 bg-white lg:block" />}>
              <Sidebar
                sidebarHidden={sidebarHidden}
                mobileOpen={mobileSidebarOpen}
                onRequestClose={() => setMobileSidebarOpen(false)}
              />
            </Suspense>
            <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:min-h-0 lg:overflow-hidden">
              <Topbar sidebarHidden={sidebarHidden} onToggleSidebar={handleSidebarToggle} />
              <main className="flex-1 min-w-0 overflow-x-hidden px-4 py-5 md:px-6 md:py-6 lg:overflow-y-auto lg:px-7 lg:py-7">
                <div className="mx-auto w-full min-w-0 max-w-[1720px] [&>*]:min-w-0">
                  <WorkspaceModeRouteGuard>{children}</WorkspaceModeRouteGuard>
                </div>
              </main>
            </div>
          </div>
          {assistantExperienceEnabled ? <GlobalAiCopilot /> : null}
          {assistantExperienceEnabled ? <CopilotActionContextToast /> : null}
        </AiCopilotProvider>
      </AnalyticsFiltersProvider>
    </div>
  );
}
