import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isIncidentKind } from "@/lib/safety-incident-policy";
import { SafetyInputError, safetyActor, safetyBody, safetyDate, safetyFailure, safetyResponse, safetyText } from "@/lib/safety-incident-server";

export async function GET(request: NextRequest) {
  try {
    const actor = await safetyActor(request);
    const scope = request.nextUrl.searchParams.get("scope");
    const cursor = request.nextUrl.searchParams.get("cursor");
    const closed = scope === "closed";
    const reviewQueue = actor.canReview && scope !== "mine";
    const coordinationQueue = actor.canCoordinate && scope !== "mine";
    const state = closed ? { equals: "CLOSED" } : { not: "CLOSED" };
    const where = reviewQueue || coordinationQueue ? { state } : { reportedById: actor.id };
    if (cursor && !(await prisma.safetyIncident.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) {
      throw new SafetyInputError("Refresh the list and retry.", 404);
    }
    const [rows, assignedActions] = await Promise.all([
      prisma.safetyIncident.findMany({
        where,
        orderBy: [{ reportedAt: "desc" }, { id: "desc" }],
        take: 41,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, reportedAt: true, state: true,
          ...(!coordinationQueue ? { kind: true, occurredAt: true } : {}),
          ...(coordinationQueue ? { actions: {
            where: { state: { not: "VERIFIED" } }, select: { dueDate: true, state: true }
          } } : {}),
          ...(reviewQueue ? { location: true, highPotential: true, confirmedImpact: true, injuryObserved: true } : {})
        }
      }),
      prisma.safetyAction.findMany({
        where: { ownerId: actor.id, state: { not: "VERIFIED" } },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }], take: 100,
        select: { id: true, incidentId: true, task: true, state: true, dueDate: true, incident: { select: { revision: true } } }
      })
    ]);
    return safetyResponse({
      canReview: actor.canReview, canCoordinate: actor.canCoordinate,
      reports: rows.slice(0, 40), nextCursor: rows.length > 40 ? rows[39].id : null,
      assignedActions
    });
  } catch (error) { return safetyFailure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await safetyActor(request);
    const input = await safetyBody(request);
    if (input.offlineOwnerId !== undefined && input.offlineOwnerId !== actor.id) {
      throw new SafetyInputError("Sign in with the same account that saved this report.", 403);
    }
    const submissionKey = safetyText(input.submissionKey, "a submission reference", 36, true);
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(submissionKey)) {
      throw new SafetyInputError("Reload the form and try again.");
    }
    const key = { reportedById: actor.id, submissionKey };
    const existing = await prisma.safetyIncident.findUnique({ where: { reportedById_submissionKey: key }, select: { id: true } });
    if (existing) return safetyResponse(existing);

    const kind = safetyText(input.kind, "an incident type", 20, true);
    if (!isIncidentKind(kind)) throw new SafetyInputError("Choose an incident type.");
    const occurredAt = safetyDate(input.occurredAt, "incident time");
    if (occurredAt.getTime() > Date.now() + 5 * 60000) throw new SafetyInputError("Incident time cannot be in the future.");
    const shift = input.shift === "DAY" || input.shift === "NIGHT" ? input.shift : null;
    const projectId = safetyText(input.projectId, "project reference", 100) || null;
    const rigId = safetyText(input.rigId, "rig reference", 100) || null;
    const [project, rig] = await Promise.all([
      projectId ? prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }) : null,
      rigId ? prisma.rig.findUnique({ where: { id: rigId }, select: { id: true } }) : null
    ]);
    if ((projectId && !project) || (rigId && !rig)) throw new SafetyInputError("The linked project or rig was not found.");
    try {
      const report = await prisma.safetyIncident.create({
        data: {
          ...key, kind, occurredAt, projectId, rigId, shift,
          injuryObserved: typeof input.injuryObserved === "boolean" ? input.injuryObserved : null,
          location: safetyText(input.location, "where it happened", 150, true),
          description: safetyText(input.description, "what happened", 2000, true),
          immediateResponse: safetyText(input.immediateResponse, "immediate response", 1000) || null,
          events: { create: { actorId: actor.id, kind: "REPORTED" } }
        },
        select: { id: true }
      });
      return safetyResponse(report, 201);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const report = await prisma.safetyIncident.findUniqueOrThrow({ where: { reportedById_submissionKey: key }, select: { id: true } });
      return safetyResponse(report);
    }
  } catch (error) { return safetyFailure(error); }
}
