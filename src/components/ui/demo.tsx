"use client";

import { SessionNavBar } from "@/components/ui/sidebar";

export function SidebarDemo() {
  return (
    <div className="flex h-screen w-screen flex-row">
      <SessionNavBar sidebarHidden={false} mobileOpen onRequestClose={() => undefined} />
      <main className="flex h-screen grow flex-col overflow-auto" />
    </div>
  );
}
