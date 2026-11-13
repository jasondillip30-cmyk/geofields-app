import { NextResponse, type NextRequest } from "next/server";
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
  return NextResponse.json({
    ownerId: auth.session.userId,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      rigs: [...new Map([project.assignedRig, project.backupRig]
        .filter((rig) => rig?.status === "ACTIVE")
        .map((rig) => [rig!.id, { id: rig!.id, name: rig!.rigCode }])).values()],
      billingVersion: offlineBillingVersion(project, project.billingRateItems),
      extraItems: buildGuidedBillableInputsModel(project.billingRateItems).extraItems
        .map(({ itemCode, label, unit }) => ({ itemCode, label, unit }))
    }))
  }, { headers });
}
