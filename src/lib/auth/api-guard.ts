import { NextResponse, type NextRequest } from "next/server";

import { canAccess, type Permission } from "@/lib/auth/permissions";
import { getSessionFromRequest } from "@/lib/auth/session";

export async function requireApiPermission(request: NextRequest, permission: Permission) {
  const session = await getSessionFromRequest(request);

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
  const session = await getSessionFromRequest(request);

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
