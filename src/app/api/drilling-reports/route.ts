import type { EntryApprovalStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
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
  stageDrillReportConsumables
} from "@/lib/drill-report-consumables";
import {
  normalizeDelayReasonNote,
  parseDelayReasonCategory,
  validateDelayReasonInput
} from "@/lib/drill-report-delay-reasons";
import { evaluateDrillReportHoleContinuity } from "@/lib/drill-report-continuity";
import { prisma } from "@/lib/prisma";
import { assertActiveProjectForDrilling, ProjectClosedForDrillingError } from "@/lib/project-drilling-guard";
import { resolveProjectOperationalStatus } from "@/lib/project-status-policy";
import { canSyncOfflineDrilling, offlineBillingSelect, offlineBillingVersion, offlineDigest } from "@/lib/offline-drilling-server";
import { buildGuidedBillableLineInputs } from "@/lib/drilling-report-guided-inputs";
import { parseDrillingShift } from "@/lib/drilling-shifts";

class OfflineSubmissionAlreadySaved extends Error {}

const reportInclude = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, status: true, contractRatePerM: true } },
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

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "drilling:view");
  if (!auth.ok) {
    return auth.response;
  }

  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const approvalStatus = parseApprovalStatusFilter(request.nextUrl.searchParams.get("approvalStatus"));

  const where = {
    ...(clientId ? { clientId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(approvalStatus ? { approvalStatus } : {}),
    ...(fromDate || toDate
      ? {
          date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  };

  const reports = await prisma.drillReport.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: reportInclude
  });
  const reportsWithEffectiveBillable = await enrichReportsWithEffectiveBillableAmount(reports);
  const stats = calculateStats(reportsWithEffectiveBillable);

  return NextResponse.json({ data: reportsWithEffectiveBillable, stats });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "drilling:submit");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const offlineKey = request.headers.get("Idempotency-Key");
  const offlineScope = offlineKey ? { userId: auth.session.userId, key: offlineKey } : null;
  const offlineHash = offlineScope ? offlineDigest(body) : "";
  async function replayOfflineSubmission() {
    if (!offlineScope) return null;
    const saved = await prisma.offlineDrillingSubmission.findUnique({ where: { userId_key: offlineScope } });
    if (!saved) return null;
    return saved.payloadHash === offlineHash
      ? NextResponse.json({ reportId: saved.reportId, replayed: true })
      : NextResponse.json({ message: "This offline submission was already used for a different report." }, { status: 409 });
  }
  if (offlineKey !== null) {
    if (!offlineScope || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(offlineKey) ||
        !body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ message: "Invalid offline submission." }, { status: 400 });
    }
    if (body.offlineOwnerId !== offlineScope.userId || !(await canSyncOfflineDrilling(offlineScope.userId))) {
      return NextResponse.json({ message: "Sign in as the account that saved this report." }, { status: 403 });
    }
    const replay = await replayOfflineSubmission();
    if (replay) return replay;
  }

  const date = typeof body?.date === "string" ? body.date : "";
  const shift = parseDrillingShift(body?.shift);
  if (shift.error) return NextResponse.json({ message: shift.error }, { status: 400 });
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const rigId = typeof body?.rigId === "string" ? body.rigId : "";
  const holeNumber = typeof body?.holeNumber === "string" ? body.holeNumber.trim() : "";
  const areaLocation = typeof body?.areaLocation === "string" ? body.areaLocation.trim() : "";
  const delayHours = toNumber(body?.delayHours);
  const leadOperatorName = normalizeOptionalText(body?.leadOperatorName);
  const assistantCount = parseAssistantCount(body?.assistantCount);
  const fallbackOperatorCrew = normalizeOptionalText(body?.operatorCrew);
  const operatorCrew = buildOperatorCrewSummary({
    leadOperatorName,
    assistantCount,
    fallbackOperatorCrew
  });
  const holeContinuityOverrideReason = normalizeOptionalText(body?.holeContinuityOverrideReason);
  const delayReasonCategory = parseDelayReasonCategory(body?.delayReasonCategory);
  const delayReasonNote = normalizeDelayReasonNote(body?.delayReasonNote);
  const hasBillableLinesField = Boolean(offlineScope ||
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

  const [project, rig, activeRateItems] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        clientId: true,
        status: true,
        endDate: true,
        closedAt: true,
        contractType: true,
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
      select: offlineBillingSelect
    })
  ]);

  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }
  if (resolveProjectOperationalStatus(project) !== "ACTIVE") {
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

  const fromMeter = toNumber(body?.fromMeter);
  const toMeter = toNumber(body?.toMeter);
  let billingLines = billableLinesResult.lines;
  if (offlineScope) {
    const parsedDate = new Date(date + "T00:00:00.000Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date || ![body.fromMeter, body.toMeter, body.workHours, body.standbyHours, body.rigMoves, body.delayHours]
        .every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0) ||
      fromMeter > toMeter || !Number.isSafeInteger(body.rigMoves) || body.rigMoves > 2147483647) {
      return NextResponse.json({ message: "Check the work date, depths, hours, and rig moves." }, { status: 400 });
    }
    if (body.offlineBillingVersion !== offlineBillingVersion(project, activeRateItems)) {
      return NextResponse.json({ message: "The billing setup changed. Refresh field setup and review the report before trying again." }, { status: 422 });
    }
    const guided = buildGuidedBillableLineInputs({
      billingItems: activeRateItems,
      metersDrilledToday: toMeter - fromMeter,
      derivedFromMeter: fromMeter, derivedToMeter: toMeter,
      workHours: body.workHours, standbyHours: body.standbyHours, rigMoves: body.rigMoves,
      manualQuantities: body.manualQuantities ?? {}
    });
    if (guided.error || guided.stagedUnallocatedMeters > 0) {
      return NextResponse.json({ message: guided.error || "Some drilled meters fall outside the billing depth bands. Review the report online." }, { status: 422 });
    }
    billingLines = guided.lines;
  }
  const continuity = await evaluateDrillReportHoleContinuity(prisma, {
    projectId,
    holeNumber,
    fromMeter
  });
  if (continuity.overrideRequired && !holeContinuityOverrideReason) {
    const replay = await replayOfflineSubmission();
    if (replay) return replay;
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
    ? await validateDrillReportBillableLinesForProject(prisma, projectId, billingLines, {
        holeNumber,
        fromMeter,
        toMeter
      })
    : { lines: [], error: null };
  if (validatedBillableLinesResult.error) {
    return NextResponse.json({ message: validatedBillableLinesResult.error }, { status: 400 });
  }

  const totalMetersFromInput = offlineScope ? 0 : toNumber(body?.totalMetersDrilled);
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
  let created: Awaited<ReturnType<typeof prisma.drillReport.findUniqueOrThrow>>;
  try {
    created = await prisma.$transaction(async (tx) => {
      await assertActiveProjectForDrilling(tx, projectId);
      const pendingConsumables = await stageDrillReportConsumables(tx, projectId, consumablesUsedResult.lines);
      const insertedBase = await tx.drillReport.create({
        data: {
          date: reportDate,
          shift: shift.value,
        clientId: project.clientId,
        projectId,
        rigId,
        submittedById: auth.session.userId,
        approvalStatus: "SUBMITTED",
        submittedAt: new Date(),
        pendingConsumables,
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
        await replaceDrillReportBillableLines(tx, insertedBase.id, validatedBillableLinesResult.lines);
      }
      if (offlineScope) {
        // The key and report commit together, including audit and billable lines.
        const claim = await tx.offlineDrillingSubmission.createMany({
          data: { ...offlineScope, payloadHash: offlineHash, reportId: insertedBase.id },
          skipDuplicates: true
        });
        if (!claim.count) throw new OfflineSubmissionAlreadySaved();
      }
      const inserted = await tx.drillReport.findUniqueOrThrow({
        where: { id: insertedBase.id },
        include: reportInclude
      });

      await recordAuditLog({
        db: tx,
        module: "drilling_reports",
        entityType: "drilling_report",
        entityId: inserted.id,
        action: "create",
        description: `${auth.session.name} created Drilling Report ${inserted.id}.`,
        after: reportAuditSnapshot(inserted),
        actor: auditActorFromSession(auth.session)
      });

      return inserted;
    });
  } catch (error) {
    if (error instanceof OfflineSubmissionAlreadySaved) {
      const replay = await replayOfflineSubmission();
      if (replay) return replay;
    }
    if (error instanceof DrillReportConsumablesValidationError || error instanceof ProjectClosedForDrillingError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    throw error;
  }

  if (offlineScope) {
    return NextResponse.json({ reportId: created.id, replayed: false }, { status: 201 });
  }
  const reports = await prisma.drillReport.findMany({
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: reportInclude
  });
  const reportsWithEffectiveBillable = await enrichReportsWithEffectiveBillableAmount(reports);

  return NextResponse.json(
    {
      data: created,
      calculatedBillableAmount: billableAmount,
      stats: calculateStats(reportsWithEffectiveBillable)
    },
    { status: 201 }
  );
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

function calculateStats(
  reports: Array<{
    totalMetersDrilled: number;
    billableAmount: number;
    approvalStatus: EntryApprovalStatus;
    workHours: number;
  }>
) {
  const reportsLogged = reports.length;
  const totalMeters = reports.reduce((sum, report) => sum + report.totalMetersDrilled, 0);
  const billableActivity = reports.reduce(
    (sum, report) => sum + (report.approvalStatus === "APPROVED" ? report.billableAmount : 0),
    0
  );
  const totalHours = reports.reduce((sum, report) => sum + report.workHours, 0);

  return {
    reportsLogged,
    totalMeters,
    billableActivity,
    averageWorkHours: reportsLogged > 0 ? totalHours / reportsLogged : 0
  };
}

async function enrichReportsWithEffectiveBillableAmount<
  T extends {
    projectId: string;
    totalMetersDrilled: number;
    billableAmount: number;
    workHours: number;
    billableLines: Array<{ itemCode: string; unit: string; quantity: number }>;
    project: { contractRatePerM: number };
  }
>(reports: T[]) {
  if (reports.length === 0) {
    return reports;
  }

  const projectIds = Array.from(new Set(reports.map((report) => report.projectId)));
  const activeRateItems = await prisma.projectBillingRateItem.findMany({
    where: {
      projectId: {
        in: projectIds
      },
      isActive: true
    },
    select: {
      projectId: true,
      itemCode: true,
      unit: true,
      unitRate: true
    }
  });

  const rateItemsByProjectId = activeRateItems.reduce<
    Map<string, Array<{ itemCode: string; unit: string; unitRate: number }>>
  >((accumulator, item) => {
    const current = accumulator.get(item.projectId) || [];
    current.push({
      itemCode: item.itemCode,
      unit: item.unit,
      unitRate: item.unitRate
    });
    accumulator.set(item.projectId, current);
    return accumulator;
  }, new Map());

  return reports.map((report) => {
    const effectiveBillable = roundCurrency(
      calculateDrillReportBillableAmount({
        billableLines: report.billableLines,
        activeRateItems: rateItemsByProjectId.get(report.projectId) || [],
        fallbackMeters: report.totalMetersDrilled,
        fallbackContractRate: report.project.contractRatePerM
      })
    );
    return {
      ...report,
      billableAmount: effectiveBillable
    };
  }) as T[];
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function parseDateOrNull(value: string | null, endOfDay = false) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (endOfDay) {
    parsed.setUTCHours(23, 59, 59, 999);
  } else {
    parsed.setUTCHours(0, 0, 0, 0);
  }

  return parsed;
}

function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
}

function parseApprovalStatusFilter(value: string | null): EntryApprovalStatus | null {
  if (!value || value === "all") {
    return null;
  }
  const normalized = value.toUpperCase();
  if (normalized === "DRAFT" || normalized === "SUBMITTED" || normalized === "APPROVED" || normalized === "REJECTED") {
    return normalized;
  }
  return null;
}

function reportAuditSnapshot(report: {
  id: string;
  date: Date;
  shift: string | null;
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
    shift: report.shift,
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
