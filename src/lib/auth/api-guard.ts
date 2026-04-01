import { NextResponse, type NextRequest } from "next/server";

import { canAccess, type Permission } from "@/lib/auth/permissions";
import { AuthConfigurationError } from "@/lib/auth/secret";
import { getSessionFromRequest } from "@/lib/auth/session";

async function getSafeSession(request: NextRequest) {
  try {
    return { ok: true as const, session: await getSessionFromRequest(request) };
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return {
        ok: false as const,
        response: NextResponse.json(
          { message: "Server auth configuration error: missing AUTH_SECRET." },
          { status: 500 }
        )
      };
    }
    throw error;
  }
}

export async function requireApiPermission(request: NextRequest, permission: Permission) {
  const sessionResult = await getSafeSession(request);
  if (!sessionResult.ok) {
    return sessionResult;
  }

  const { session } = sessionResult;

  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    };
  }

  if (!canAccess(session.role, permission)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { message: `Forbidden: missing required permission '${permission}'.` },
        { status: 403 }
      )
    };
  }

  return { ok: true as const, session };
}

export async function requireAnyApiPermission(
  request: NextRequest,
  permissions: Permission[]
) {
  const sessionResult = await getSafeSession(request);
  if (!sessionResult.ok) {
    return sessionResult;
  }

  const { session } = sessionResult;

  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    };
  }

  const hasPermission = permissions.some((permission) => canAccess(session.role, permission));
  if (!hasPermission) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { message: `Forbidden: missing one of required permissions [${permissions.join(", ")}].` },
        { status: 403 }
      )
    };
  }

  return { ok: true as const, session };
}
