import { Prisma, ProjectContractType, ProjectStatus } from "@prisma/client";
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

function parseProjectContractType(value: unknown): ProjectContractType {
  if (typeof value !== "string") {
    return ProjectContractType.PER_METER;
  }
  const upper = value.toUpperCase();
  if (upper in ProjectContractType) {
    return ProjectContractType[upper as keyof typeof ProjectContractType];
  }
  return ProjectContractType.PER_METER;
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
  const budgetAmount = parsePositiveNumberOrNull(body?.budgetAmount);
  const setupProfile = parseProjectSetupProfileInput(body?.setupProfile);
  const contractType = parseProjectContractType(body?.contractType);
  const meterRate = parseNonNegativeNumber(body?.contractRatePerM);
  const dayRate = parseNonNegativeNumber(body?.contractDayRate);
  const lumpSumValue = parseNonNegativeNumber(body?.contractLumpSumValue);
  const estimatedMeters = parseNonNegativeNumber(body?.estimatedMeters ?? setupProfile.expectedMeters);
  const estimatedDays = parseNonNegativeNumber(body?.estimatedDays);
  const commercialValidationError = validateCommercialTerms({
    contractType,
    meterRate,
    dayRate,
    lumpSumValue
  });

  if (!name || !clientId || !location || !startDate) {
    return NextResponse.json(
      { message: "name, clientId, location, and startDate are required." },
      { status: 400 }
    );
  }
  if (commercialValidationError) {
    return NextResponse.json({ message: commercialValidationError }, { status: 400 });
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
        contractType,
        contractRatePerM: meterRate,
        contractDayRate: dayRate,
        contractLumpSumValue: lumpSumValue,
        estimatedMeters,
        estimatedDays,
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
  contractType: string;
  contractDayRate: number;
  contractLumpSumValue: number;
  estimatedMeters: number;
  estimatedDays: number;
}) {
  return {
    id: project.id,
    name: project.name,
    clientId: project.clientId,
    location: project.location,
    status: project.status,
    contractType: project.contractType,
    assignedRigId: project.assignedRigId,
    backupRigId: project.backupRigId,
    contractRatePerM: project.contractRatePerM,
    contractDayRate: project.contractDayRate,
    contractLumpSumValue: project.contractLumpSumValue,
    estimatedMeters: project.estimatedMeters,
    estimatedDays: project.estimatedDays
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

function parseNonNegativeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function validateCommercialTerms(options: {
  contractType: ProjectContractType;
  meterRate: number;
  dayRate: number;
  lumpSumValue: number;
}) {
  if (options.contractType === ProjectContractType.PER_METER && options.meterRate <= 0) {
    return "Meter rate must be greater than zero for per-meter contracts.";
  }
  if (options.contractType === ProjectContractType.DAY_RATE && options.dayRate <= 0) {
    return "Day rate must be greater than zero for per-day contracts.";
  }
  if (options.contractType === ProjectContractType.LUMP_SUM && options.lumpSumValue <= 0) {
    return "Lump-sum value must be greater than zero for lump-sum contracts.";
  }
  return null;
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
