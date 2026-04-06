import { ProjectContractType } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission, requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { withFinancialDrillReportApproval } from "@/lib/financial-approval-policy";
import {
  buildProjectCommercialRevenueSnapshot,
  deriveWorkProgressFromReports,
  PROJECT_CONTRACT_TYPE_LABEL
} from "@/lib/project-commercials";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const auth = await requireAnyApiPermission(request, ["projects:view", "finance:view"]);
  if (!auth.ok) {
    return auth.response;
  }

  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: {
        select: {
          id: true,
          name: true
        }
      },
      assignedRig: {
        select: {
          id: true,
          rigCode: true
        }
      },
      changeOrders: {
        orderBy: [{ createdAt: "desc" }]
      }
    }
  });

  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }

  const approvedReports = await prisma.drillReport.findMany({
    where: withFinancialDrillReportApproval({ projectId }),
    select: {
      date: true,
      totalMetersDrilled: true
    }
  });

  const workProgress = deriveWorkProgressFromReports(approvedReports);
  const revenueSnapshot = buildProjectCommercialRevenueSnapshot({
    terms: {
      contractType: project.contractType,
      contractRatePerM: project.contractRatePerM,
      contractDayRate: project.contractDayRate,
      contractLumpSumValue: project.contractLumpSumValue,
      estimatedMeters: project.estimatedMeters,
      estimatedDays: project.estimatedDays,
      status: project.status
    },
    work: workProgress,
    changeOrders: project.changeOrders.map((order) => ({
      id: order.id,
      description: order.description,
      addedValue: order.addedValue,
      addedMeters: order.addedMeters,
      addedDays: order.addedDays,
      createdAt: order.createdAt
    }))
  });

  return NextResponse.json({
    data: {
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        startDate: project.startDate,
        endDate: project.endDate,
        client: project.client,
        assignedRig: project.assignedRig
      },
      contractTerms: {
        contractType: project.contractType,
        contractTypeLabel: PROJECT_CONTRACT_TYPE_LABEL[project.contractType],
        contractRatePerM: project.contractRatePerM,
        contractDayRate: project.contractDayRate,
        contractLumpSumValue: project.contractLumpSumValue,
        estimatedMeters: project.estimatedMeters,
        estimatedDays: project.estimatedDays
      },
      workProgress,
      revenue: revenueSnapshot,
      changeOrders: project.changeOrders
    }
  });
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
  const contractType = parseProjectContractType(body?.contractType);
  const contractRatePerM = parseNonNegativeNumber(body?.contractRatePerM);
  const contractDayRate = parseNonNegativeNumber(body?.contractDayRate);
  const contractLumpSumValue = parseNonNegativeNumber(body?.contractLumpSumValue);
  const estimatedMeters = parseNonNegativeNumber(body?.estimatedMeters);
  const estimatedDays = parseNonNegativeNumber(body?.estimatedDays);

  const validationError = validateCommercialTerms({
    contractType,
    meterRate: contractRatePerM,
    dayRate: contractDayRate,
    lumpSumValue: contractLumpSumValue
  });
  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  const existing = await prisma.project.findUnique({ where: { id: projectId } });
  if (!existing) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.project.update({
      where: { id: projectId },
      data: {
        contractType,
        contractRatePerM,
        contractDayRate,
        contractLumpSumValue,
        estimatedMeters,
        estimatedDays
      }
    });

    await recordAuditLog({
      db: tx,
      module: "projects",
      entityType: "project",
      entityId: projectId,
      action: "edit",
      description: `${auth.session.name} updated project commercials for ${next.name}.`,
      before: {
        contractType: existing.contractType,
        contractRatePerM: existing.contractRatePerM,
        contractDayRate: existing.contractDayRate,
        contractLumpSumValue: existing.contractLumpSumValue,
        estimatedMeters: existing.estimatedMeters,
        estimatedDays: existing.estimatedDays
      },
      after: {
        contractType: next.contractType,
        contractRatePerM: next.contractRatePerM,
        contractDayRate: next.contractDayRate,
        contractLumpSumValue: next.contractLumpSumValue,
        estimatedMeters: next.estimatedMeters,
        estimatedDays: next.estimatedDays
      },
      actor: auditActorFromSession(auth.session)
    });

    return next;
  });

  return NextResponse.json({
    data: {
      id: updated.id,
      contractType: updated.contractType,
      contractRatePerM: updated.contractRatePerM,
      contractDayRate: updated.contractDayRate,
      contractLumpSumValue: updated.contractLumpSumValue,
      estimatedMeters: updated.estimatedMeters,
      estimatedDays: updated.estimatedDays
    }
  });
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
