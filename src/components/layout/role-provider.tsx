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

interface RoleContextValue {
  role: UserRole | null;
  user: { id: string; name: string; email: string; role: UserRole } | null;
  loading: boolean;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
}

const RoleContext = createContext<RoleContextValue | undefined>(undefined);

export function RoleProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; name: string; email: string; role: UserRole } | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshInFlightRef = useRef(false);

  const refreshSession = useCallback(async () => {
    if (refreshInFlightRef.current) {
      console.info("[role-provider] refresh-session:skip-duplicate");
      return;
    }

    refreshInFlightRef.current = true;
    setLoading(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    const watchdogId = window.setTimeout(() => {
      if (!refreshInFlightRef.current) {
        return;
      }
      console.error("[role-provider] refresh-session:watchdog-timeout");
      setLoading(false);
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
      const responseBody = (await response.clone().text().catch(() => "")).trim();

      console.info("[role-provider] refresh-session:response", {
        status: response.status,
        body: responseBody || "(empty)"
      });

      if (!response.ok) {
        setUser(null);
        return;
      }

      const data = await response.json();
      if (!data || typeof data !== "object" || !("user" in data)) {
        setUser(null);
        console.error("[role-provider] refresh-session:invalid-payload", { data });
        return;
      }

      setUser((data as { user: { id: string; name: string; email: string; role: UserRole } }).user);
    } catch (error) {
      setUser(null);
      console.error("[role-provider] refresh-session:error", {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined
      });
    } finally {
      window.clearTimeout(timeoutId);
      window.clearTimeout(watchdogId);
      refreshInFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

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
        refreshSession,
        logout
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const context = useContext(RoleContext);
  if (!context) {
    throw new Error("useRole must be used inside RoleProvider");
  }
  return context;
}
