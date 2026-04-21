import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { isWorkspaceLaunchEnabled } from "@/lib/feature-flags";
import { AuthConfigurationError } from "@/lib/auth/secret";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-config";
import { verifySessionToken } from "@/lib/auth/session";
import { buildWorkshopScopedHref } from "@/lib/auth/workspace-launch-access";
import type { UserRole } from "@/lib/types";

export default async function WorkspaceLaunchPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isWorkspaceLaunchEnabled()) {
    redirect("/");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const params = new URLSearchParams();
  params.set("launch", "1");
  const from = asSingleValue(resolvedSearchParams?.from);
  const to = asSingleValue(resolvedSearchParams?.to);

  const session = await resolveLaunchSessionRole();
  if (session?.role === "MECHANIC") {
    redirect(buildWorkshopScopedHref("/maintenance", { from, to }));
  }

  if (from) {
    params.set("from", from);
  }
  if (to) {
    params.set("to", to);
  }

  redirect(`/rigs?${params.toString()}`);
}

function asSingleValue(value: string | string[] | undefined) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0] || "";
  }
  return "";
}

async function resolveLaunchSessionRole() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  try {
    const session = await verifySessionToken(token);
    if (!session) {
      return null;
    }
    return { role: session.role as UserRole };
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return null;
    }
    throw error;
  }
}
