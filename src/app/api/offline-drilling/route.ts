import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { canSyncOfflineDrilling, offlineBillingSelect, offlineBillingVersion } from "@/lib/offline-drilling-server";
import { prisma } from "@/lib/prisma";
import { unclosedProjectWhere } from "@/lib/project-status-policy";
import { buildGuidedBillableInputsModel } from "@/lib/drilling-report-guided-inputs";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "drilling:submit");
  if (!auth.ok) return auth.response;
  const headers = { "Cache-Control": "private, no-store" };
  if (!(await canSyncOfflineDrilling(auth.session.userId))) {
    return NextResponse.json({ message: "Offline drilling access is not available for this account." }, { status: 403, headers });
  }
  const projects = await prisma.project.findMany({
    where: {
      AND: [unclosedProjectWhere()], status: "ACTIVE",
      OR: [{ assignedRig: { status: "ACTIVE" } }, { backupRig: { status: "ACTIVE" } }]
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true, name: true, contractType: true, contractRatePerM: true,
      assignedRig: { select: { id: true, rigCode: true, status: true } },
      backupRig: { select: { id: true, rigCode: true, status: true } },
      billingRateItems: { where: { isActive: true }, select: offlineBillingSelect }
    }
  });
  const recentHoles = new Map<string, Array<{ holeNumber: string; depth: number }>>();
  if (projects.length) {
    const holes = await prisma.$queryRaw<Array<{ projectId: string; holeNumber: string; depth: number }>>`
      WITH holes AS (
        SELECT "projectId", "holeNumber", MAX(GREATEST(0, "fromMeter", "toMeter")) AS depth,
          MAX(date) AS latest
        FROM "DrillReport"
        WHERE "projectId" IN (${Prisma.join(projects.map(({ id }) => id))})
          AND "approvalStatus" <> 'REJECTED'
        GROUP BY "projectId", "holeNumber"
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY latest DESC, "holeNumber") AS position
        FROM holes
      )
      SELECT "projectId", "holeNumber", depth FROM ranked WHERE position <= 20
      ORDER BY "projectId", position
    `;
    for (const { projectId, holeNumber, depth } of holes) {
      if (!Number.isFinite(depth) || !holeNumber.trim()) continue;
      const list = recentHoles.get(projectId) ?? [];
      list.push({ holeNumber, depth });
      recentHoles.set(projectId, list);
    }
  }
  return NextResponse.json({
    ownerId: auth.session.userId,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      recentHoles: recentHoles.get(project.id) ?? [],
      rigs: [...new Map([project.assignedRig, project.backupRig]
        .filter((rig) => rig?.status === "ACTIVE")
        .map((rig) => [rig!.id, { id: rig!.id, name: rig!.rigCode }])).values()],
      billingVersion: offlineBillingVersion(project, project.billingRateItems),
      extraItems: buildGuidedBillableInputsModel(project.billingRateItems).extraItems
        .map(({ itemCode, label, unit }) => ({ itemCode, label, unit }))
    }))
  }, { headers });
}
