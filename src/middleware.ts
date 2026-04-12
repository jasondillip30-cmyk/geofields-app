import { NextResponse, type NextRequest } from "next/server";

import { canAccess } from "@/lib/auth/permissions";
import { getPermissionForPath } from "@/lib/auth/route-permissions";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-config";
import { AuthConfigurationError } from "@/lib/auth/secret";
import { verifyEdgeSessionToken } from "@/lib/auth/session-edge";

const publicPaths = ["/login", "/unauthorized"];

function isPublicPath(pathname: string) {
  return publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function normalizeAuthPath(pathname: string) {
  const match = pathname.match(/^\/(login|unauthorized)\.+(?=\/|$)/i);
  if (!match) {
    return null;
  }
  const normalized = pathname.replace(/^\/(login|unauthorized)\.+(?=\/|$)/i, `/${match[1]!.toLowerCase()}`);
  return normalized === pathname ? null : normalized;
}

function isPublicAsset(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/public")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApiRoute = pathname.startsWith("/api/");
  const normalizedAuthPath = normalizeAuthPath(pathname);

  if (normalizedAuthPath) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = normalizedAuthPath;
    return NextResponse.redirect(redirectUrl);
  }

  if (isPublicAsset(pathname) || isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    if (isApiRoute) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  let session = null;
  try {
    session = await verifyEdgeSessionToken(token);
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      const message = "Server auth configuration error: missing AUTH_SECRET.";
      return isApiRoute
        ? NextResponse.json({ message }, { status: 500 })
        : new NextResponse(message, { status: 500 });
    }
    throw error;
  }

  if (!session) {
    if (isApiRoute) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (!isApiRoute && (pathname.startsWith("/spending/profit") || pathname.startsWith("/spending/expenses"))) {
    const hasFinanceAccess = canAccess(session.role, "finance:view");
    const hasDrillingAccess = canAccess(session.role, "drilling:view");
    if (!hasFinanceAccess && hasDrillingAccess) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/spending";
      redirectUrl.searchParams.set("view", "drilling-reports");
      return NextResponse.redirect(redirectUrl);
    }
  }

  if (isApiRoute) {
    return NextResponse.next();
  }

  const requiredPermission = getPermissionForPath(pathname);
  if (requiredPermission && !canAccess(session.role, requiredPermission)) {
    return NextResponse.redirect(new URL("/unauthorized", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
