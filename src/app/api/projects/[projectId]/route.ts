import { Prisma, ProjectContractType, ProjectStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import {
  parseProjectBillingRateItemsInput,
  replaceProjectBillingRateItems
} from "@/lib/project-billing-rate-card";
import { prisma } from "@/lib/prisma";

const PROJECT_SETUP_REPORT_TYPE = "PROJECT_SETUP_PROFILE";

interface ParsedProjectSetupProfile {
  expectedMeters: number | null;
  contractReferenceUrl: string;
  contractReferenceName: string;
  teamMemberIds: string[];
  teamMemberNames: string[];
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
  const hasBillingRateItemsField = Boolean(
    body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "billingRateItems")
  );
  const billingRateItemsResult = parseProjectBillingRateItemsInput(
    hasBillingRateItemsField ? (body as Record<string, unknown>).billingRateItems : undefined
  );
  const contractType = parseProjectContractType(body?.contractType);
  const meterRate = parseNonNegativeNumber(body?.contractRatePerM);
  const dayRate = parseNonNegativeNumber(body?.contractDayRate);
  const lumpSumValue = parseNonNegativeNumber(body?.contractLumpSumValue);
  const estimatedMeters = parseNonNegativeNumber(body?.estimatedMeters ?? setupProfile.expectedMeters);
  const estimatedDays = parseNonNegativeNumber(body?.estimatedDays);

  if (!name || !clientId || !location || !startDate) {
    return NextResponse.json(
      { message: "name, clientId, location, and startDate are required." },
      { status: 400 }
    );
  }
  if (billingRateItemsResult.error) {
    return NextResponse.json({ message: billingRateItemsResult.error }, { status: 400 });
  }

  const existing = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      billingRateItems: {
        where: {
          isActive: true
        },
        select: {
          id: true
        }
      }
    }
  });
  if (!existing) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }
  const parsedStartDate = new Date(startDate);
  const parsedEndDate =
    typeof body?.endDate === "string" && body.endDate ? new Date(body.endDate) : null;

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.project.update({
      where: { id: projectId },
      data: {
        name,
        clientId,
        location,
        description: typeof body?.description === "string" ? body.description.trim() : null,
        photoUrl: typeof body?.photoUrl === "string" ? body.photoUrl.trim() : null,
        startDate: parsedStartDate,
        endDate: parsedEndDate,
        status: deriveProjectStatusFromDates(parsedStartDate, parsedEndDate),
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
    if (hasBillingRateItemsField) {
      await replaceProjectBillingRateItems(tx, next.id, billingRateItemsResult.items);
    }

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

function deriveProjectStatusFromDates(startDate: Date, endDate: Date | null): ProjectStatus {
  if (Number.isNaN(startDate.getTime())) {
    return ProjectStatus.PLANNED;
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());

  if (start > today) {
    return ProjectStatus.PLANNED;
  }

  if (endDate && !Number.isNaN(endDate.getTime())) {
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    if (end < today) {
      return ProjectStatus.COMPLETED;
    }
  }

  return ProjectStatus.ACTIVE;
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
