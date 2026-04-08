import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { canUseElevatedDrillingEdit } from "@/lib/auth/approval-policy";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { calculateDrillReportBillableAmount } from "@/lib/drill-report-billable-amount";
import {
  parseDrillReportBillableLinesInput,
  replaceDrillReportBillableLines,
  validateDrillReportBillableLinesForProject
} from "@/lib/drill-report-billable-lines";
import {
  DrillReportConsumablesValidationError,
  parseDrillReportConsumablesUsedInput,
  replaceDrillReportConsumablesUsage
} from "@/lib/drill-report-consumables";
import {
  normalizeDelayReasonNote,
  parseDelayReasonCategory,
  validateDelayReasonInput
} from "@/lib/drill-report-delay-reasons";
import { evaluateDrillReportHoleContinuity } from "@/lib/drill-report-continuity";
import { prisma } from "@/lib/prisma";

const reportInclude = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, status: true } },
  rig: { select: { id: true, rigCode: true, status: true } },
  submittedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  billableLines: {
    orderBy: { itemCode: "asc" },
    select: {
      itemCode: true,
      unit: true,
      quantity: true
    }
  },
  inventoryUsageRequests: {
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      quantity: true,
      reason: true,
      approvedMovementId: true,
      createdAt: true,
      decidedAt: true,
      item: {
        select: {
          id: true,
          name: true,
          sku: true
        }
      }
    }
  },
  inventoryMovements: {
    where: {
      movementType: "OUT",
      contextType: "DRILLING_REPORT"
    },
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      quantity: true,
      totalCost: true,
      item: {
        select: {
          id: true,
          name: true,
          sku: true
        }
      },
      expense: {
        select: {
          id: true,
          amount: true,
          approvalStatus: true
        }
      }
    }
  }
} as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const auth = await requireApiPermission(request, "drilling:submit");
  if (!auth.ok) {
    return auth.response;
  }

  const { reportId } = await params;
  const body = await request.json().catch(() => null);

  const date = typeof body?.date === "string" ? body.date : "";
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const rigId = typeof body?.rigId === "string" ? body.rigId : "";
  const holeNumber = typeof body?.holeNumber === "string" ? body.holeNumber.trim() : "";
  const areaLocation = typeof body?.areaLocation === "string" ? body.areaLocation.trim() : "";
  const delayHours = toNumber(body?.delayHours);
  const hasLeadOperatorNameField = Boolean(
    body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "leadOperatorName")
  );
  const hasAssistantCountField = Boolean(
    body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "assistantCount")
  );
  const leadOperatorNameInput = normalizeOptionalText(body?.leadOperatorName);
  const assistantCountInput = parseAssistantCount(body?.assistantCount);
  const fallbackOperatorCrew = normalizeOptionalText(body?.operatorCrew);
  const holeContinuityOverrideReason = normalizeOptionalText(body?.holeContinuityOverrideReason);
  const delayReasonCategory = parseDelayReasonCategory(body?.delayReasonCategory);
  const delayReasonNote = normalizeDelayReasonNote(body?.delayReasonNote);
  const hasBillableLinesField = Boolean(
    body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "billableLines")
  );
  const hasConsumablesUsedField = Boolean(
    body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "consumablesUsed")
  );
  const billableLinesResult = parseDrillReportBillableLinesInput(
    hasBillableLinesField ? (body as Record<string, unknown>).billableLines : undefined
  );
  const consumablesUsedResult = parseDrillReportConsumablesUsedInput(
    hasConsumablesUsedField ? (body as Record<string, unknown>).consumablesUsed : undefined
  );

  if (!date || !projectId || !rigId || !holeNumber || !areaLocation) {
    return NextResponse.json(
      { message: "date, projectId, rigId, holeNumber, and areaLocation are required." },
      { status: 400 }
    );
  }

  const existing = await prisma.drillReport.findUnique({
    where: { id: reportId },
    include: reportInclude
  });
  if (!existing) {
    return NextResponse.json({ message: "Drilling report not found." }, { status: 404 });
  }

  const isOwner = existing.submittedById === auth.session.userId;
  if (!canUseElevatedDrillingEdit(auth.session.role) && !isOwner) {
    return NextResponse.json(
      { message: "You can only edit drilling reports that you created." },
      { status: 403 }
    );
  }

  const [project, rig, activeRateItems] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        clientId: true,
        status: true,
        contractRatePerM: true,
        assignedRigId: true,
        backupRigId: true
      }
    }),
    prisma.rig.findUnique({
      where: { id: rigId },
      select: { id: true, status: true }
    }),
    prisma.projectBillingRateItem.findMany({
      where: {
        projectId,
        isActive: true
      },
      select: {
        itemCode: true,
        unit: true,
        unitRate: true
      }
    })
  ]);

  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }
  if (project.status !== "ACTIVE") {
    return NextResponse.json({ message: "Only ACTIVE projects can receive daily drilling reports." }, { status: 400 });
  }
  const allowedRigIds = [project.assignedRigId, project.backupRigId].filter(
    (value): value is string => Boolean(value)
  );
  if (allowedRigIds.length === 0) {
    return NextResponse.json(
      { message: "This project has no assigned rig. Assign a rig to the project first." },
      { status: 400 }
    );
  }
  if (!allowedRigIds.includes(rigId)) {
    return NextResponse.json(
      { message: "Selected rig is not assigned to this project. Choose one of the project rigs." },
      { status: 400 }
    );
  }

  if (!rig) {
    return NextResponse.json({ message: "Rig not found." }, { status: 404 });
  }
  if (rig.status !== "ACTIVE") {
    return NextResponse.json({ message: "Only ACTIVE rigs can be used for daily drilling reports." }, { status: 400 });
  }
  if (billableLinesResult.error) {
    return NextResponse.json({ message: billableLinesResult.error }, { status: 400 });
  }
  if (consumablesUsedResult.error) {
    return NextResponse.json({ message: consumablesUsedResult.error }, { status: 400 });
  }
  const leadOperatorName = hasLeadOperatorNameField ? leadOperatorNameInput : existing.leadOperatorName;
  const assistantCount = hasAssistantCountField ? assistantCountInput : existing.assistantCount;
  const operatorCrew = buildOperatorCrewSummary({
    leadOperatorName,
    assistantCount,
    fallbackOperatorCrew: fallbackOperatorCrew ?? existing.operatorCrew
  });

  const fromMeter = toNumber(body?.fromMeter);
  const toMeter = toNumber(body?.toMeter);
  const continuity = await evaluateDrillReportHoleContinuity(prisma, {
    projectId,
    holeNumber,
    fromMeter,
    excludeReportId: reportId
  });
  if (continuity.overrideRequired && !holeContinuityOverrideReason) {
    return NextResponse.json(
      { message: continuity.message || "Add a short reason to continue with a different starting depth." },
      { status: 400 }
    );
  }
  const delayReasonValidation = validateDelayReasonInput({
    delayHours,
    delayReasonCategory,
    delayReasonNote
  });
  if (delayReasonValidation.error) {
    return NextResponse.json({ message: delayReasonValidation.error }, { status: 400 });
  }
  const validatedBillableLinesResult = hasBillableLinesField
    ? await validateDrillReportBillableLinesForProject(prisma, projectId, billableLinesResult.lines, {
        holeNumber,
        fromMeter,
        toMeter
      })
    : { lines: [], error: null };
  if (validatedBillableLinesResult.error) {
    return NextResponse.json({ message: validatedBillableLinesResult.error }, { status: 400 });
  }

  const totalMetersFromInput = toNumber(body?.totalMetersDrilled);
  const totalMetersDrilled = totalMetersFromInput > 0 ? totalMetersFromInput : Math.max(0, toMeter - fromMeter);
  const billableAmount = roundCurrency(
    calculateDrillReportBillableAmount({
      billableLines: validatedBillableLinesResult.lines,
      activeRateItems,
      fallbackMeters: totalMetersDrilled,
      fallbackContractRate: project.contractRatePerM
    })
  );

  const reportDate = new Date(date);
  let updated: Awaited<ReturnType<typeof prisma.drillReport.findUniqueOrThrow>>;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const nextBase = await tx.drillReport.update({
        where: { id: reportId },
        data: {
          date: reportDate,
        clientId: project.clientId,
        projectId,
        rigId,
        approvalStatus: "APPROVED",
        submittedAt: existing.submittedAt || new Date(),
        approvedById: auth.session.userId,
        approvedAt: new Date(),
        rejectionReason: null,
        holeNumber,
        areaLocation,
        fromMeter,
        toMeter,
        totalMetersDrilled,
        workHours: toNumber(body?.workHours),
        rigMoves: Math.round(toNumber(body?.rigMoves)),
        standbyHours: toNumber(body?.standbyHours),
        delayHours,
        delayReasonCategory: delayReasonValidation.delayReasonCategory,
        delayReasonNote: delayReasonValidation.delayReasonNote,
        holeContinuityOverrideReason: continuity.isBroken ? holeContinuityOverrideReason : null,
        comments: typeof body?.comments === "string" ? body.comments.trim() : null,
        leadOperatorName,
        assistantCount,
        operatorCrew,
        billableAmount
        }
      });
      if (hasBillableLinesField) {
        await replaceDrillReportBillableLines(tx, nextBase.id, validatedBillableLinesResult.lines);
      }
      if (hasConsumablesUsedField) {
        await replaceDrillReportConsumablesUsage({
          tx,
          drillReportId: nextBase.id,
          projectId,
          rigId,
          clientId: project.clientId,
          reportDate,
          actorUserId: auth.session.userId,
          lines: consumablesUsedResult.lines,
          resetExisting: true
        });
      }

      const next = await tx.drillReport.findUniqueOrThrow({
        where: { id: nextBase.id },
        include: reportInclude
      });

      await recordAuditLog({
        db: tx,
        module: "drilling_reports",
        entityType: "drilling_report",
        entityId: reportId,
        action: "edit",
        description: `${auth.session.name} edited Drilling Report ${reportId}.`,
        before: reportAuditSnapshot(existing),
        after: reportAuditSnapshot(next),
        actor: auditActorFromSession(auth.session)
      });

      return next;
    });
  } catch (error) {
    if (error instanceof DrillReportConsumablesValidationError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    throw error;
  }

  return NextResponse.json({ data: updated });
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isNaN(numeric) ? 0 : numeric;
}

function parseAssistantCount(value: unknown) {
  const parsed = Math.round(toNumber(value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildOperatorCrewSummary({
  leadOperatorName,
  assistantCount,
  fallbackOperatorCrew
}: {
  leadOperatorName: string | null;
  assistantCount: number;
  fallbackOperatorCrew: string | null;
}) {
  if (leadOperatorName && assistantCount > 0) {
    return `${leadOperatorName} + ${assistantCount} assistant${assistantCount === 1 ? "" : "s"}`;
  }
  if (leadOperatorName) {
    return leadOperatorName;
  }
  if (assistantCount > 0) {
    return `${assistantCount} assistant${assistantCount === 1 ? "" : "s"}`;
  }
  return fallbackOperatorCrew;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function reportAuditSnapshot(report: {
  id: string;
  date: Date;
  projectId: string;
  rigId: string;
  clientId: string;
  totalMetersDrilled: number;
  billableAmount: number;
  approvalStatus: string;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
  delayReasonCategory: string | null;
  delayReasonNote: string | null;
  holeContinuityOverrideReason: string | null;
  leadOperatorName: string | null;
  assistantCount: number;
}) {
  return {
    id: report.id,
    date: report.date,
    projectId: report.projectId,
    rigId: report.rigId,
    clientId: report.clientId,
    totalMetersDrilled: report.totalMetersDrilled,
    billableAmount: report.billableAmount,
    approvalStatus: report.approvalStatus,
    submittedAt: report.submittedAt,
    approvedAt: report.approvedAt,
    rejectionReason: report.rejectionReason,
    delayReasonCategory: report.delayReasonCategory,
    delayReasonNote: report.delayReasonNote,
    holeContinuityOverrideReason: report.holeContinuityOverrideReason,
    leadOperatorName: report.leadOperatorName,
    assistantCount: report.assistantCount
  };
}
