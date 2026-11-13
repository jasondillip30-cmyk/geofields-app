import type { Prisma, ProjectOperatingCostKind, ProjectOperatingCostCadence } from "@prisma/client";

import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import type { AuthSession } from "@/lib/auth/session-types";
import { prisma } from "@/lib/prisma";
import {
  nextOperatingCostDate, parseOperatingCostCents, parseOperatingCostDate, PROJECT_OPERATING_COST_SOURCE
} from "@/lib/project-operating-cost-policy";

const kinds = ["CREW_PAY", "FOOD", "OTHER"] as const;
const cadences = ["ONCE", "DAILY", "WEEKLY", "MONTHLY"] as const;
const categories: Record<ProjectOperatingCostKind, string> = { CREW_PAY: "Labor", FOOD: "Camp Food", OTHER: "Other" };
const costDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC"
});

export class OperatingCostError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export async function readProjectOperatingCosts(projectId: string, month: string) {
  const from = parseOperatingCostDate(month + "-01");
  if (!from) throw new OperatingCostError("Choose a valid cost month.");
  const until = nextOperatingCostDate(from, "MONTHLY", 1)!;
  const [plans, entries, employees] = await Promise.all([
    prisma.projectOperatingCostPlan.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    prisma.projectOperatingCostDraft.findMany({
      where: { projectId, costDate: { gte: from, lt: until } },
      orderBy: [{ costDate: "desc" }, { createdAt: "asc" }],
      select: {
        id: true, costDate: true, amountCents: true, status: true, expenseId: true,
        plan: { select: { kind: true, label: true, crewJob: true } }
      }
    }),
    prisma.user.findMany({
      where: { isActive: true }, select: { id: true, fullName: true, title: true }, orderBy: { fullName: "asc" }
    })
  ]);
  return { plans, entries, employees };
}

export async function changeProjectOperatingCosts(projectId: string, actor: AuthSession, body: Record<string, unknown>) {
  return prisma.$transaction(async (tx) => {
    // Serialize this project's changes so generation, confirmation and correction cannot overlap.
    const [project] = await tx.$queryRaw<Array<{ id: string; clientId: string; endDate: Date | null; closedAt: Date | null }>>`
      SELECT "id", "clientId", "endDate", "closedAt" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE
    `;
    if (!project) throw new OperatingCostError("Project not found.", 404);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const end = project.closedAt ?? project.endDate;
    const through = end && end < today ? end : today;
    const audit = (action: string, id: string, after?: Record<string, unknown>) => recordAuditLog({
      db: tx, module: "expenses", entityType: "project_operating_cost", entityId: id,
      action, description: "Project operating costs: " + action.replaceAll("_", " "),
      after: { projectId, ...after }, actor: auditActorFromSession(actor)
    });

    switch (body.action) {
      case "create": {
        const kind = readOption(kinds, body.kind);
        const cadence = readOption(cadences, body.cadence);
        const startsOn = parseOperatingCostDate(body.startsOn);
        const endsOn = body.endsOn ? parseOperatingCostDate(body.endsOn) : null;
        const amountCents = parseOperatingCostCents(body.amount);
        if (!kind || !cadence) throw new OperatingCostError("Choose a valid cost type and repeat schedule.");
        if (!amountCents) throw new OperatingCostError("Enter a positive amount with no more than two decimal places.");
        if (!startsOn) {
          throw new OperatingCostError(kind === "CREW_PAY" ? "Choose a valid first pay month." : "Choose a valid cost date.");
        }
        if (body.endsOn && !endsOn) throw new OperatingCostError("Choose a valid stop date or leave it blank.");
        if (endsOn && endsOn < startsOn) {
          throw new OperatingCostError("The stop date cannot be before the first cost date.");
        }
        if (end && startsOn > end) {
          const cutoff = costDateFormatter.format(end);
          const field = kind === "CREW_PAY" ? "first pay month" : "cost date";
          const reason = project.closedAt ? `This project closed on ${cutoff}.` : `This project's end date is ${cutoff}.`;
          throw new OperatingCostError(`${reason} Choose a ${field} on or before that date.`);
        }
        let label = readLabel(body.label);
        let employeeId: string | null = null;
        let crewJob: string | null = null;
        if (kind === "CREW_PAY") {
          if (!["MONTHLY", "ONCE"].includes(cadence) || startsOn.getUTCDate() !== 1) {
            throw new OperatingCostError("Crew pay uses the first day of the month as its cost period.");
          }
          const employee = await tx.user.findFirst({
            where: { id: readLabel(body.employeeId), isActive: true },
            select: { id: true, fullName: true }
          });
          crewJob = readLabel(body.crewJob);
          if (!employee || !crewJob) throw new OperatingCostError("Choose an active employee and enter their job on this project.");
          label = employee.fullName;
          employeeId = employee.id;
          const overlap = await tx.projectOperatingCostPlan.findFirst({
            where: {
              projectId, employeeId, nextDue: { not: null },
              ...(endsOn ? { nextDue: { not: null, lte: endsOn } } : {}),
              OR: [{ endsOn: null }, { endsOn: { gte: startsOn } }]
            }, select: { id: true }
          });
          const existing = await tx.projectOperatingCostDraft.findFirst({
            where: { projectId, employeeId, costDate: startsOn }, select: { id: true }
          });
          if (overlap || existing) throw new OperatingCostError("This employee already has a schedule or draft for that period on this project.", 409);
        }
        if (!label) throw new OperatingCostError("Enter a short description for this cost.");
        const plan = await tx.projectOperatingCostPlan.create({
          data: { projectId, kind, label, employeeId, crewJob, amountCents, cadence, startsOn, endsOn, nextDue: startsOn }
        });
        const count = await generateDrafts(tx, plan, through, 1);
        await audit("create_schedule", plan.id);
        return { count, month: startsOn.toISOString().slice(0, 7) };
      }
      case "generate": {
        const plans = await tx.projectOperatingCostPlan.findMany({ where: { projectId, nextDue: { lte: through } }, orderBy: { nextDue: "asc" }, take: 100 });
        let count = 0;
        for (const plan of plans) {
          if (count >= 100) break;
          count += await generateDrafts(tx, plan, through, 100 - count);
        }
        if (count) await audit("generate_drafts", projectId, { count });
        return { count };
      }
      case "stop": {
        const result = await tx.projectOperatingCostPlan.updateMany({
          where: { projectId, id: readLabel(body.id), nextDue: { not: null } }, data: { nextDue: null }
        });
        if (!result.count) throw new OperatingCostError("This schedule is already stopped or complete.", 409);
        await audit("stop_schedule", readLabel(body.id));
        return {};
      }
      case "edit":
      case "skip":
      case "restore": {
        const id = readLabel(body.id);
        const draft = await tx.projectOperatingCostDraft.findFirst({ where: { id, projectId }, select: { status: true } });
        const expected = body.action === "restore" ? "SKIPPED" : "DRAFT";
        if (!draft || draft.status !== expected) throw new OperatingCostError("This draft has changed. Refresh before continuing.", 409);
        if (body.action === "edit") {
          const amountCents = parseOperatingCostCents(body.amount);
          if (!amountCents) throw new OperatingCostError("Enter a positive amount with up to two decimal places.");
          await tx.projectOperatingCostDraft.update({ where: { id }, data: { amountCents } });
        } else {
          await tx.projectOperatingCostDraft.update({ where: { id }, data: { status: body.action === "skip" ? "SKIPPED" : "DRAFT" } });
        }
        await audit(String(body.action) + "_draft", id);
        return {};
      }
      case "confirm": {
        const costDate = parseOperatingCostDate(body.costDate);
        const kind = readOption(kinds, body.kind);
        const draftIds = Array.isArray(body.draftIds) ? body.draftIds.filter((id): id is string => typeof id === "string") : [];
        if (!costDate || costDate > through || !kind || !draftIds.length) throw new OperatingCostError("Review the draft costs before confirming.");
        if (kind === "CREW_PAY" && await tx.projectOperatingCostDraft.findFirst({
          where: { projectId, costDate, status: "POSTED", plan: { kind } }, select: { id: true }
        })) {
          throw new OperatingCostError("Crew pay is already posted for this period. Reopen the posting to confirm an updated combined total.", 409);
        }
        const drafts = await tx.projectOperatingCostDraft.findMany({
          where: { projectId, costDate, status: "DRAFT", plan: { kind } }, select: { id: true, amountCents: true }
        });
        const cents = drafts.reduce((sum, entry) => sum + entry.amountCents, 0);
        if (drafts.length !== draftIds.length || !drafts.every(({ id }) => draftIds.includes(id)) || cents !== body.expectedCents) {
          throw new OperatingCostError("Draft costs changed. Refresh and review the amounts again.", 409);
        }
        const now = new Date();
        const expense = await tx.expense.create({
          data: {
            projectId, clientId: project.clientId, date: costDate, amount: cents / 100, category: categories[kind],
            entrySource: PROJECT_OPERATING_COST_SOURCE, approvalStatus: "APPROVED",
            submittedAt: now, approvedAt: now, enteredByUserId: actor.userId, approvedById: actor.userId
          }, select: { id: true }
        });
        await tx.projectOperatingCostDraft.updateMany({ where: { id: { in: draftIds }, projectId }, data: { status: "POSTED", expenseId: expense.id } });
        await audit("confirm_costs", expense.id, { kind, count: drafts.length, costDate });
        return { expenseId: expense.id };
      }
      case "reverse": {
        const expenseId = readLabel(body.id);
        const reason = readLabel(body.reason);
        if (reason.length < 3) throw new OperatingCostError("A correction reason is required.");
        const changed = await tx.expense.updateMany({
          where: {
            id: expenseId, projectId, entrySource: PROJECT_OPERATING_COST_SOURCE, approvalStatus: "APPROVED",
            operatingCostDrafts: { some: { projectId, status: "POSTED" } }
          },
          data: { approvalStatus: "REJECTED", rejectionReason: "Reversed in Project Operating Costs." }
        });
        if (!changed.count) throw new OperatingCostError("This posting is no longer available to reverse.", 409);
        await tx.projectOperatingCostDraft.updateMany({
          where: { projectId, expenseId, status: "POSTED" }, data: { status: "DRAFT", expenseId: null }
        });
        await audit("reverse_costs", expenseId, { reasonCode: "CORRECTION" });
        // Correction notes stay out of the shared expense and audit feeds.
        await tx.projectOperatingCostCorrection.create({ data: { expenseId, projectId, reason, actorId: actor.userId } });
        return {};
      }
      default:
        throw new OperatingCostError("Unknown operating cost action.");
    }
  }, { timeout: 15000 });
}

async function generateDrafts(tx: Prisma.TransactionClient, plan: {
  id: string; projectId: string; employeeId: string | null; amountCents: number; cadence: ProjectOperatingCostCadence;
  startsOn: Date; endsOn: Date | null; nextDue: Date | null;
}, through: Date, limit: number) {
  let date = plan.nextDue;
  const rows: Prisma.ProjectOperatingCostDraftCreateManyInput[] = [];
  while (date && date <= through && (!plan.endsOn || date <= plan.endsOn) && rows.length < limit) {
    rows.push({ planId: plan.id, projectId: plan.projectId, employeeId: plan.employeeId, costDate: date, amountCents: plan.amountCents });
    date = nextOperatingCostDate(date, plan.cadence, plan.startsOn.getUTCDate());
  }
  if (!rows.length) return 0;
  const result = await tx.projectOperatingCostDraft.createMany({ data: rows, skipDuplicates: true });
  await tx.projectOperatingCostPlan.update({
    where: { id: plan.id }, data: { nextDue: date && (!plan.endsOn || date <= plan.endsOn) ? date : null }
  });
  return result.count;
}

function readLabel(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function readOption<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.find((option) => option === value);
}
