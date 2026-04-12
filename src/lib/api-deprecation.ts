import type { NextResponse } from "next/server";

const warnedRoutes = new Set<string>();
const LEGACY_FINANCE_SUNSET = "Wed, 31 Dec 2026 00:00:00 GMT";

export function withLegacyFinanceDeprecationHeaders(response: NextResponse, route: string) {
  response.headers.set("Deprecation", "true");
  response.headers.set("Sunset", LEGACY_FINANCE_SUNSET);
  response.headers.set("Link", '</api/spending/summary>; rel="successor-version"');
  response.headers.append(
    "Warning",
    `299 geofields "${route} is deprecated. Use /api/spending/* endpoints for Spending-first finance data."`
  );
  return response;
}

export function logLegacyFinanceApiUsage(route: string) {
  if (warnedRoutes.has(route)) {
    return;
  }
  warnedRoutes.add(route);
  console.warn(`[deprecated-finance-api] ${route} is deprecated. Prefer /api/spending/*.`);
}
