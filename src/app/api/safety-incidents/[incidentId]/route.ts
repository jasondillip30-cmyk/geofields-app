import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isIncidentImpact, safetyCloseoutProblem } from "@/lib/safety-incident-policy";
import { SafetyInputError, safetyActor, safetyBody, safetyDate, safetyFailure, safetyResponse, safetyText } from "@/lib/safety-incident-server";

type RouteContext = { params: Promise<{ incidentId: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await safetyActor(request);
    const { incidentId } = await params;
    if (actor.canCoordinate) {
      const incident = await prisma.safetyIncident.findUnique({
        where: { id: incidentId }, select: {
          id: true, revision: true, state: true, reportedAt: true,
          events: { where: { kind: "PUBLISH_BRIEF" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { note: true } },
          actions: { orderBy: { dueDate: "asc" }, select: {
            id: true, task: true, state: true, dueDate: true, owner: { select: { fullName: true } }
          } }
        }
      });
      if (!incident) throw new SafetyInputError("Safety record not found.", 404);
      const { events, ...coordination } = incident;
      const owners = incident.state === "CLOSED" ? [] : await prisma.user.findMany({
        where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" }
      });
      return safetyResponse({ coordination: { ...coordination, brief: events[0]?.note ?? null }, owners });
    }
    if (!actor.canReview) throw new SafetyInputError("Safety record not found.", 404);
    const [incident, owners] = await Promise.all([
      prisma.safetyIncident.findUnique({
        where: { id: incidentId }, include: {
          reportedBy: { select: { fullName: true } },
          project: { select: { id: true, name: true } },
          rig: { select: { id: true, rigCode: true } },
          breakdownReport: { select: { id: true, title: true } },
          maintenanceRequest: { select: { id: true, requestCode: true } },
          actions: { include: { owner: { select: { fullName: true } } }, orderBy: { dueDate: "asc" } },
          events: { include: { actor: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 100 }
        }
      }),
      prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } })
    ]);
    if (!incident) throw new SafetyInputError("Safety record not found.", 404);
    const context = { ...(incident.projectId ? { projectId: incident.projectId } : {}),
      ...(incident.rigId ? { rigId: incident.rigId } : {}) };
    const [breakdowns, maintenance] = await Promise.all([
      prisma.breakdownReport.findMany({ where: context, orderBy: { reportDate: "desc" }, take: 30,
        select: { id: true, title: true, rig: { select: { rigCode: true } } } }),
      prisma.maintenanceRequest.findMany({ where: context, orderBy: { requestDate: "desc" }, take: 30,
        select: { id: true, requestCode: true, rig: { select: { rigCode: true } } } })
    ]);
    const briefEvent = await prisma.safetyIncidentEvent.findFirst({
      where: { incidentId, kind: "PUBLISH_BRIEF" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { note: true }
    });
    return safetyResponse({ incident, owners, breakdowns, maintenance, brief: briefEvent?.note ?? null });
  } catch (error) { return safetyFailure(error); }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await safetyActor(request);
    const { incidentId } = await params;
    const input = await safetyBody(request);
    const command = safetyText(input.command, "a review action", 20, true);
    const revision = input.revision;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0 || revision > 2147483646) {
      throw new SafetyInputError("Refresh the case and try again.");
    }
    const coordinating = actor.canCoordinate && command === "ADD_ACTION";
    if (!actor.canReview && !coordinating && command !== "COMPLETE_ACTION") throw new SafetyInputError("Safety record not found.", 404);
    const actionId = safetyText(input.actionId, "follow-up task reference", 100) || null;
    await prisma.$transaction(async (tx) => {
      if (!actor.canReview && !coordinating && !(actionId && await tx.safetyAction.findFirst({
        where: { id: actionId, incidentId, ownerId: actor.id }, select: { id: true }
      }))) throw new SafetyInputError("Safety record not found.", 404);

      // All edits lock the same case, including assignee updates, so closeout cannot race an action change.
      const updated = await tx.safetyIncident.updateMany({
        where: { id: incidentId, revision, state: { not: "CLOSED" } }, data: { revision: { increment: 1 } }
      });
      if (!updated.count) throw new SafetyInputError("This case changed or closed. Reload it before updating.", 409);
      const incident = await tx.safetyIncident.findUniqueOrThrow({ where: { id: incidentId } });
      let eventActionId = actionId;
      let eventNote: string | null = null;

      if (command === "TRIAGE") {
        const impact = safetyText(input.confirmedImpact, "the reviewed outcome", 25, true);
        if (!isIncidentImpact(impact) || typeof input.highPotential !== "boolean") {
          throw new SafetyInputError("Choose the outcome and whether this was high potential.");
        }
        const breakdownReportId = safetyText(input.breakdownReportId, "breakdown reference", 100) || null;
        const maintenanceRequestId = safetyText(input.maintenanceRequestId, "maintenance reference", 100) || null;
        const [breakdown, maintenance] = await Promise.all([
          breakdownReportId ? tx.breakdownReport.findUnique({
            where: { id: breakdownReportId }, select: { projectId: true, rigId: true }
          }) : null,
          maintenanceRequestId ? tx.maintenanceRequest.findUnique({
            where: { id: maintenanceRequestId }, select: { projectId: true, rigId: true, breakdownReportId: true }
          }) : null
        ]);
        if ((breakdownReportId && !breakdown) || (maintenanceRequestId && !maintenance) ||
            [breakdown, maintenance].some((link) => link && (
              (incident.rigId && incident.rigId !== link.rigId) || (incident.projectId && link.projectId && incident.projectId !== link.projectId)
            )) || (breakdown && maintenance && (breakdown.rigId !== maintenance.rigId ||
              (maintenance.breakdownReportId && maintenance.breakdownReportId !== breakdownReportId) ||
              (maintenance.projectId && maintenance.projectId !== breakdown.projectId)))) {
          throw new SafetyInputError("Choose a breakdown or maintenance record consistent with this incident.");
        }
        await tx.safetyIncident.update({
          where: { id: incidentId }, data: {
            state: "REVIEWING", confirmedImpact: impact, highPotential: input.highPotential,
            findings: safetyText(input.findings, "investigation findings", 4000) || null,
            breakdownReportId, maintenanceRequestId
          }
        });
      } else if (command === "PUBLISH_BRIEF") {
        eventNote = safetyText(input.brief, "a coordination note", 500) || null;
      } else if (command === "ADD_ACTION") {
        const ownerId = safetyText(input.ownerId, "an action owner", 100, true);
        const owner = await tx.user.findFirst({ where: { id: ownerId, isActive: true }, select: { id: true } });
        if (!owner) throw new SafetyInputError("Choose an active action owner.");
        const action = await tx.safetyAction.create({ data: {
          incidentId, ownerId, task: safetyText(input.task, "a follow-up action", 300, true),
          dueDate: safetyDate(input.dueDate, "due date", true)
        } });
        eventActionId = action.id;
      } else if (command === "COMPLETE_ACTION" || command === "VERIFY_ACTION" || command === "RETURN_ACTION") {
        const expectedState = command === "COMPLETE_ACTION" ? "OPEN" : "DONE";
        const nextState = command === "COMPLETE_ACTION" ? "DONE" : command === "RETURN_ACTION" ? "OPEN" : "VERIFIED";
        eventNote = safetyText(input.evidence, "what was done or verified", 1000, true);
        const action = await tx.safetyAction.updateMany({
          where: { id: actionId || "", incidentId, state: expectedState, ...(!actor.canReview ? { ownerId: actor.id } : {}) },
          data: { state: nextState, ...(command === "COMPLETE_ACTION" ? { evidence: eventNote } : {}) }
        });
        if (!action.count) throw new SafetyInputError("The action has changed. Reload the case.", 409);
      } else if (command === "CLOSE") {
        const actions = await tx.safetyAction.findMany({ where: { incidentId }, select: { state: true } });
        const problem = safetyCloseoutProblem(incident, actions.map((action) => action.state));
        if (problem) throw new SafetyInputError(problem, 409);
        const note = safetyText(input.closeoutNote, "how the fix was verified or why no action was needed", 2000, true);
        await tx.safetyIncident.update({ where: { id: incidentId }, data: { state: "CLOSED", closedAt: new Date(), closeoutNote: note } });
      } else {
        throw new SafetyInputError("Choose a valid review action.");
      }
      await tx.safetyIncidentEvent.create({ data: {
        incidentId, actorId: actor.id, kind: command, actionId: eventActionId, note: eventNote
      } });
    });
    return safetyResponse({ ok: true });
  } catch (error) { return safetyFailure(error); }
}
