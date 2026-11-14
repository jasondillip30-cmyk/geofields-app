import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { recentShiftWeekStart, shiftWeek } from "@/lib/drilling-shifts";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "drilling:view");
  if (!auth.ok) return auth.response;
  const projectId = request.nextUrl.searchParams.get("projectId")?.trim();
  const week = shiftWeek(request.nextUrl.searchParams.get("start") ?? recentShiftWeekStart());
  if (!projectId || !week) {
    return NextResponse.json({ message: "Select a project and a valid week." }, { status: 400 });
  }
  const rigSelect = { id: true, rigCode: true } as const;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { assignedRig: { select: rigSelect }, backupRig: { select: rigSelect } }
  });
  if (!project) return NextResponse.json({ message: "Project not found." }, { status: 404 });
  const reports = await prisma.drillReport.findMany({
    where: { projectId, date: { gte: week.from, lt: week.until } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true, date: true, shift: true, rigId: true, rig: { select: rigSelect },
      holeNumber: true, totalMetersDrilled: true, workHours: true, standbyHours: true,
      delayHours: true, delayReasonCategory: true, delayReasonNote: true, approvalStatus: true
    }
  });
  const rigs = new Map<string, string>();
  for (const rig of [project.assignedRig, project.backupRig, ...reports.map(({ rig }) => rig)]) {
    if (rig) rigs.set(rig.id, rig.rigCode);
  }
  return NextResponse.json({
    rigs: Array.from(rigs, ([id, label]) => ({ id, label })),
    reports
  }, { headers: { "Cache-Control": "private, no-store" } });
}
