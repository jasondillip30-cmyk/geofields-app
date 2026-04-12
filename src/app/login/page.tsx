"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { getDefaultRouteForRole } from "@/lib/auth/landing";
import { canAccess } from "@/lib/auth/permissions";
import { getPermissionForPath } from "@/lib/auth/route-permissions";
import type { UserRole } from "@/lib/types";
import { useRole } from "@/components/layout/role-provider";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshSession } = useRole();
  const [email, setEmail] = useState("admin@geofields.co.tz");
  const [password, setPassword] = useState("Admin123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const nextPath = sanitizeNextPath(searchParams.get("next"));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ message: "Login failed." }));
        setError(payload.message || "Login failed.");
        return;
      }

      const payload = await response.json();
      await refreshSession();

      const role = payload?.user?.role as UserRole | undefined;
      const nextPermission = nextPath ? getPermissionForPath(nextPath) : null;
      const canUseNext = Boolean(role && nextPath && (!nextPermission || canAccess(role, nextPermission)));
      const redirectPath = canUseNext ? nextPath! : role ? getDefaultRouteForRole(role) : "/";
      router.push(redirectPath);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <LoginShell
      loading={loading}
      error={error}
      email={email}
      password={password}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={handleSubmit}
    />
  );
}

function LoginShell({
  loading,
  error,
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSubmit
}: {
  loading: boolean;
  error: string;
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-app-gradient px-4">
      <section className="w-full max-w-md rounded-2xl border border-white/80 bg-white/90 p-6 shadow-card">
        <h1 className="font-display text-2xl text-ink-900">GeoFields Sign In</h1>
        <p className="mt-1 text-sm text-ink-600">
          Use your employee account credentials to access the operations dashboard.
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <label className="block text-sm text-ink-700">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 outline-none ring-brand-300 focus:ring"
              required
            />
          </label>
          <label className="block text-sm text-ink-700">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 outline-none ring-brand-300 focus:ring"
              required
            />
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-ink-600">
          <p>Seed login examples:</p>
          <p>admin@geofields.co.tz / Admin123!</p>
          <p>office@geofields.co.tz / Office123!</p>
          <p>mechanic@geofields.co.tz / Mechanic123!</p>
          <p>field@geofields.co.tz / Field123!</p>
        </div>
      </section>
    </main>
  );
}

function LoginFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-app-gradient px-4">
      <section className="w-full max-w-md rounded-2xl border border-white/80 bg-white/90 p-6 text-sm text-ink-700 shadow-card">
        Loading sign-in page...
      </section>
    </main>
  );
}

function sanitizeNextPath(rawNextPath: string | null) {
  if (!rawNextPath || !rawNextPath.startsWith("/") || rawNextPath.startsWith("//")) {
    return null;
  }

  const parsed = new URL(rawNextPath, "http://localhost");
  const normalizedPathname = parsed.pathname.replace(
    /^\/(login|unauthorized)\.+(?=\/|$)/i,
    (_, segment: string) => `/${segment.toLowerCase()}`
  );
  const normalizedTarget = `${normalizedPathname}${parsed.search}`;

  if (normalizedPathname.startsWith("/api/")) {
    return null;
  }

  if (
    normalizedPathname === "/login" ||
    normalizedPathname.startsWith("/login/") ||
    normalizedPathname === "/unauthorized" ||
    normalizedPathname.startsWith("/unauthorized/")
  ) {
    return null;
  }

  return normalizedTarget;
}
