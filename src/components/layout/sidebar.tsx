"use client";

import { SessionNavBar } from "@/components/ui/sidebar";

export function Sidebar({
  sidebarHidden,
  mobileOpen,
  onRequestClose
}: {
  sidebarHidden: boolean;
  mobileOpen: boolean;
  onRequestClose: () => void;
}) {
  return <SessionNavBar sidebarHidden={sidebarHidden} mobileOpen={mobileOpen} onRequestClose={onRequestClose} />;
}
