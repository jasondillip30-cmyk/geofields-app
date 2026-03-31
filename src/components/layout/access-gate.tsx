"use client";

import type { ReactNode } from "react";

import { canAccess, type Permission } from "@/lib/auth/permissions";
import { roleLabels } from "@/lib/auth/roles";
import { useRole } from "@/components/layout/role-provider";

export function AccessGate({
  permission,
  children,
  fallback
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { role, loading } = useRole();

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-sm font-medium text-ink-700">Loading access profile...</p>
        <div className="mt-3 space-y-2">
          <div className="h-3 w-48 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-32 animate-pulse rounded bg-slate-200" />
        </div>
      </div>
    );
  }

  if (!role || !canAccess(role, permission)) {
    return (
      fallback || (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h2 className="font-display text-lg">Permission required</h2>
          <p className="mt-2 text-sm">
            The {role ? roleLabels[role] : "current account"} does not currently have access to this module.
          </p>
        </div>
      )
    );
  }

  return <>{children}</>;
}
