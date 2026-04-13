"use client";

import { useEffect, useState, type ReactNode } from "react";

import { canAccess, type Permission } from "@/lib/auth/permissions";
import { roleLabels } from "@/lib/auth/roles";
import { useRole } from "@/components/layout/role-provider";
import {
  resolveDevRuntimeResetCommand,
  SESSION_BOOTSTRAP_LOADING_TIMEOUT_MS
} from "@/components/layout/session-bootstrap-recovery";

export function AccessGate({
  permission,
  anyOf,
  children,
  fallback
}: {
  permission?: Permission;
  anyOf?: Permission[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { role, loading, bootstrapError, refreshSession } = useRole();
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  useEffect(() => {
    if (!loading) {
      setLoadingTimedOut(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setLoadingTimedOut(true);
    }, SESSION_BOOTSTRAP_LOADING_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loading]);

  const recoveryMessage = bootstrapError || (loadingTimedOut ? "Access profile is taking longer than expected." : null);
  const resetCommand = resolveDevRuntimeResetCommand();

  if (loading && !recoveryMessage) {
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

  if (recoveryMessage) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <h2 className="font-display text-lg">Access profile unavailable</h2>
        <p className="mt-2 text-sm">{recoveryMessage}</p>
        <p className="mt-2 text-xs">
          If this keeps happening in local dev, run <code>{resetCommand}</code> in the app terminal and refresh.
        </p>
        <button
          type="button"
          onClick={() => {
            void refreshSession();
          }}
          className="mt-4 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
        >
          Retry session
        </button>
      </div>
    );
  }

  const allowedBySingle = permission && role ? canAccess(role, permission) : false;
  const allowedByAnyOf =
    Array.isArray(anyOf) && anyOf.length > 0 && role
      ? anyOf.some((entry) => canAccess(role, entry))
      : false;
  const hasExplicitRule = Boolean(permission || (Array.isArray(anyOf) && anyOf.length > 0));
  const isAllowed = hasExplicitRule ? allowedBySingle || allowedByAnyOf : Boolean(role);

  if (!isAllowed) {
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
