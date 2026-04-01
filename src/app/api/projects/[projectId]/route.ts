import { Prisma, ProjectStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const PROJECT_SETUP_REPORT_TYPE = "PROJECT_SETUP_PROFILE";

interface ParsedProjectSetupProfile {
  expectedMeters: number | null;
  contractReferenceUrl: string;
  contractReferenceName: string;
  teamMemberIds: string[];
  teamMemberNames: string[];
}

function parseProjectStatus(value: unknown): ProjectStatus {
  if (typeof value !== "string") {
    return ProjectStatus.PLANNED;
  }

  const upper = value.toUpperCase();
  if (upper in ProjectStatus) {
    return ProjectStatus[upper as keyof typeof ProjectStatus];
  }
  return ProjectStatus.PLANNED;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const auth = await requireApiPermission(request, "projects:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { projectId } = await params;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const startDate = typeof body?.startDate === "string" ? body.startDate : "";
  const rate = Number(body?.contractRatePerM ?? 0);
  const budgetAmount = parsePositiveNumberOrNull(body?.budgetAmount);
  const setupProfile = parseProjectSetupProfileInput(body?.setupProfile);

  if (!name || !clientId || !location || !startDate || Number.isNaN(rate)) {
    return NextResponse.json(
      { message: "name, clientId, location, startDate, and contractRatePerM are required." },
      { status: 400 }
    );
  }

  const existing = await prisma.project.findUnique({ where: { id: projectId } });
  if (!existing) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.project.update({
      where: { id: projectId },
      data: {
        name,
        clientId,
        location,
        description: typeof body?.description === "string" ? body.description.trim() : null,
        photoUrl: typeof body?.photoUrl === "string" ? body.photoUrl.trim() : null,
        startDate: new Date(startDate),
        endDate: typeof body?.endDate === "string" && body.endDate ? new Date(body.endDate) : null,
        status: parseProjectStatus(body?.status),
        contractRatePerM: rate,
        assignedRigId: typeof body?.assignedRigId === "string" && body.assignedRigId ? body.assignedRigId : null,
        backupRigId: typeof body?.backupRigId === "string" && body.backupRigId ? body.backupRigId : null
      }
    });

    await upsertProjectSetupArtifacts(tx, {
      projectId: next.id,
      clientId: next.clientId,
      projectName: next.name,
      startDate: next.startDate,
      endDate: next.endDate,
      actorUserId: auth.session.userId,
      budgetAmount,
      setupProfile
    });

    await recordAuditLog({
      db: tx,
      module: "projects",
      entityType: "project",
      entityId: projectId,
      action: "edit",
      description: `${auth.session.name} updated Project ${next.name}.`,
      before: projectAuditSnapshot(existing),
      after: projectAuditSnapshot(next),
      actor: auditActorFromSession(auth.session)
    });

    return next;
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const auth = await requireApiPermission(request, "projects:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { projectId } = await params;
  const existing = await prisma.project.findUnique({ where: { id: projectId } });
  if (!existing) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.project.delete({ where: { id: projectId } });
    await recordAuditLog({
      db: tx,
      module: "projects",
      entityType: "project",
      entityId: projectId,
      action: "delete",
      description: `${auth.session.name} deleted Project ${existing.name}.`,
      before: projectAuditSnapshot(existing),
      actor: auditActorFromSession(auth.session)
    });
  });
  return NextResponse.json({ ok: true });
}

function projectAuditSnapshot(project: {
  id: string;
  name: string;
  clientId: string;
  location: string;
  status: string;
  assignedRigId: string | null;
  backupRigId: string | null;
  contractRatePerM: number;
}) {
  return {
    id: project.id,
    name: project.name,
    clientId: project.clientId,
    location: project.location,
    status: project.status,
    assignedRigId: project.assignedRigId,
    backupRigId: project.backupRigId,
    contractRatePerM: project.contractRatePerM
  };
}

function parseProjectSetupProfileInput(value: unknown): ParsedProjectSetupProfile {
  if (!value || typeof value !== "object") {
    return {
      expectedMeters: null,
      contractReferenceUrl: "",
      contractReferenceName: "",
      teamMemberIds: [],
      teamMemberNames: []
    };
  }

  const payload = value as Record<string, unknown>;
  const expectedMeters = parsePositiveNumberOrNull(payload.expectedMeters);
  const contractReferenceUrl =
    typeof payload.contractReferenceUrl === "string" ? payload.contractReferenceUrl.trim() : "";
  const contractReferenceName =
    typeof payload.contractReferenceName === "string" ? payload.contractReferenceName.trim() : "";
  const teamMemberIds = Array.isArray(payload.teamMemberIds)
    ? Array.from(
        new Set(
          payload.teamMemberIds
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter((entry) => entry.length > 0)
        )
      )
    : [];
  const teamMemberNames = Array.isArray(payload.teamMemberNames)
    ? Array.from(
        new Set(
          payload.teamMemberNames
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter((entry) => entry.length > 0)
        )
      )
    : [];

  return {
    expectedMeters,
    contractReferenceUrl,
    contractReferenceName,
    teamMemberIds,
    teamMemberNames
  };
}

function parsePositiveNumberOrNull(value: unknown) {
  const parsed = Number(value ?? null);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

async function upsertProjectSetupArtifacts(
  tx: Prisma.TransactionClient,
  options: {
    projectId: string;
    clientId: string;
    projectName: string;
    startDate: Date;
    endDate: Date | null;
    actorUserId: string;
    budgetAmount: number | null;
    setupProfile: ParsedProjectSetupProfile;
  }
) {
  const hasSetupProfileData =
    options.setupProfile.expectedMeters !== null ||
    options.setupProfile.contractReferenceUrl.length > 0 ||
    options.setupProfile.contractReferenceName.length > 0 ||
    options.setupProfile.teamMemberIds.length > 0 ||
    options.setupProfile.teamMemberNames.length > 0;

  const existingSetup = await tx.summaryReport.findFirst({
    where: {
      reportType: PROJECT_SETUP_REPORT_TYPE,
      projectId: options.projectId
    },
    orderBy: [{ reportDate: "desc" }, { updatedAt: "desc" }],
    select: { id: true }
  });
  if (hasSetupProfileData) {
    const payloadJson = JSON.stringify(options.setupProfile);
    if (existingSetup) {
      await tx.summaryReport.update({
        where: { id: existingSetup.id },
        data: {
          reportDate: new Date(),
          payloadJson
        }
      });
    } else {
      await tx.summaryReport.create({
        data: {
          reportDate: new Date(),
          reportType: PROJECT_SETUP_REPORT_TYPE,
          clientId: options.clientId,
          projectId: options.projectId,
          payloadJson,
          generatedById: options.actorUserId
        }
      });
    }
  } else if (existingSetup) {
    await tx.summaryReport.delete({ where: { id: existingSetup.id } });
  }

  if (options.budgetAmount !== null) {
    const existingBudget = await tx.budgetPlan.findFirst({
      where: {
        scopeType: "PROJECT",
        projectId: options.projectId,
        isActive: true
      },
      orderBy: [{ periodStart: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true
      }
    });

    const periodStart = options.startDate;
    const periodEnd =
      options.endDate ||
      new Date(
        Date.UTC(
          options.startDate.getUTCFullYear() + 1,
          options.startDate.getUTCMonth(),
          options.startDate.getUTCDate(),
          23,
          59,
          59,
          999
        )
      );

    if (existingBudget) {
      await tx.budgetPlan.update({
        where: { id: existingBudget.id },
        data: {
          name: `${options.projectName} Budget`,
          amount: options.budgetAmount,
          periodStart,
          periodEnd,
          updatedById: options.actorUserId,
          clientId: options.clientId || null
        }
      });
    } else {
      await tx.budgetPlan.create({
        data: {
          scopeType: "PROJECT",
          name: `${options.projectName} Budget`,
          amount: options.budgetAmount,
          periodStart,
          periodEnd,
          isActive: true,
          clientId: options.clientId || null,
          projectId: options.projectId,
          createdById: options.actorUserId,
          updatedById: options.actorUserId
        }
      });
    }
  }
}
