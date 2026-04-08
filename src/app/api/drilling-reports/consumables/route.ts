import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { buildProjectConsumablesPool } from "@/lib/project-consumables-pool";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "drilling:view");
  if (!auth.ok) {
    return auth.response;
  }

  const projectId = (request.nextUrl.searchParams.get("projectId") || "").trim();
  const excludeDrillReportId = (request.nextUrl.searchParams.get("excludeDrillReportId") || "").trim() || null;
  if (!projectId) {
    return NextResponse.json({ message: "Project is required." }, { status: 400 });
  }

  const rows = await buildProjectConsumablesPool({
    projectId,
    includeZeroAvailable: false,
    excludeDrillReportId
  });

  return NextResponse.json({ data: rows });
}
