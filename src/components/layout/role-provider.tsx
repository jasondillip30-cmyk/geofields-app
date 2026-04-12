"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useRouter } from "next/navigation";

import type { UserRole } from "@/lib/types";

type RoleContextUser = { id: string; name: string; email: string; role: UserRole };

interface RoleContextValue {
  role: UserRole | null;
  user: RoleContextUser | null;
  loading: boolean;
  bootstrapError: string | null;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
}

const RoleContext = createContext<RoleContextValue | undefined>(undefined);
type SessionApiUser = {
  id?: string;
  userId?: string;
  name?: string;
  email?: string;
  role?: UserRole;
};

export function RoleProvider({
  children,
  initialUser = null
}: {
  children: ReactNode;
  initialUser?: RoleContextUser | null;
}) {
  const router = useRouter();
  const [user, setUser] = useState<RoleContextUser | null>(initialUser);
  const [loading, setLoading] = useState(initialUser ? false : true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const refreshInFlightRef = useRef(false);

  const refreshSessionInternal = useCallback(async ({ showLoading = true }: { showLoading?: boolean } = {}) => {
    if (refreshInFlightRef.current) {
      console.info("[role-provider] refresh-session:skip-duplicate");
      return;
    }

    refreshInFlightRef.current = true;
    if (showLoading) {
      setLoading(true);
    }
    setBootstrapError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    const watchdogId = window.setTimeout(() => {
      if (!refreshInFlightRef.current) {
        return;
      }
      console.error("[role-provider] refresh-session:watchdog-timeout");
      if (showLoading) {
        setLoading(false);
      }
      controller.abort();
    }, 5000);

    try {
      console.info("[role-provider] refresh-session:start");
      const response = await fetch("/api/auth/session", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        setUser(null);
        if (response.status !== 401) {
          setBootstrapError("Unable to load access profile. Please retry.");
        }
        return;
      }

      const data = await response.json();
      if (!data || typeof data !== "object" || !("user" in data)) {
        setUser(null);
        setBootstrapError("Access profile response was invalid. Please retry.");
        console.error("[role-provider] refresh-session:invalid-payload", { data });
        return;
      }

      const rawUser = (data as { user: SessionApiUser }).user;
      const normalizedUser = normalizeSessionUser(rawUser);
      if (!normalizedUser) {
        setUser(null);
        setBootstrapError("Access profile response was invalid. Please retry.");
        console.error("[role-provider] refresh-session:invalid-user-shape", { user: rawUser });
        return;
      }

      setUser(normalizedUser);
    } catch (error) {
      setUser(null);
      setBootstrapError("Unable to load access profile. Please retry.");
      console.error("[role-provider] refresh-session:error", {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined
      });
    } finally {
      window.clearTimeout(timeoutId);
      window.clearTimeout(watchdogId);
      refreshInFlightRef.current = false;
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  const refreshSession = useCallback(async () => {
    await refreshSessionInternal({ showLoading: true });
  }, [refreshSessionInternal]);

  useEffect(() => {
    void refreshSessionInternal({ showLoading: !initialUser });
  }, [initialUser, refreshSessionInternal]);

  useEffect(() => {
    if (!loading) {
      return;
    }
    const hardStopId = window.setTimeout(() => {
      if (!loading) {
        return;
      }
      console.error("[role-provider] loading-hard-stop");
      refreshInFlightRef.current = false;
      setUser(null);
      setBootstrapError("Access profile request timed out. Please retry.");
      setLoading(false);
    }, 15000);

    return () => {
      window.clearTimeout(hardStopId);
    };
  }, [loading]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include"
    });
    setUser(null);
    router.push("/login");
    router.refresh();
  }, [router]);

  return (
    <RoleContext.Provider
      value={{
        role: user?.role ?? null,
        user,
        loading,
        bootstrapError,
        refreshSession,
        logout
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

function normalizeSessionUser(user: SessionApiUser | null | undefined) {
  if (!user || typeof user !== "object") {
    return null;
  }

  const id = typeof user.id === "string" ? user.id : typeof user.userId === "string" ? user.userId : null;
  if (!id || typeof user.name !== "string" || typeof user.email !== "string" || !user.role) {
    return null;
  }

  return {
    id,
    name: user.name,
    email: user.email,
    role: user.role
  };
}

export function useRole() {
  const context = useContext(RoleContext);
  if (!context) {
    throw new Error("useRole must be used inside RoleProvider");
  }
  return context;
}
