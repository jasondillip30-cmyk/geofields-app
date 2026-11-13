import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { canAccess, type Permission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 20;
const TEXT_LIMIT = 2000;
const updateSelect = {
  id: true, workDate: true, workDone: true, blockers: true, nextSteps: true, createdAt: true,
  author: { select: { fullName: true } },
  rig: { select: { id: true, rigCode: true } },
  maintenanceRequest: { select: { id: true, requestCode: true } }
} satisfies Prisma.WorkshopDailyUpdateSelect;

function reply(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function authorize(request: NextRequest, permission: Permission) {
  const auth = await requireApiPermission(request, permission);
  if (!auth.ok) return auth;
  const user = await prisma.user.findUnique({
    where: { id: auth.session.userId }, select: { id: true, role: true, isActive: true }
  });
  return user?.isActive && canAccess(user.role, permission)
    ? { ok: true as const, user }
    : { ok: false as const, response: reply({ message: "Workshop update access is not available for this account." }, 403) };
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request, "workshop-updates:view");
  if (!auth.ok) return auth.response;
  const search = request.nextUrl.searchParams;
  const from = parseWorkDate(search.get("from"));
  const to = parseWorkDate(search.get("to"));
  const cursor = search.get("cursor");
  if ((search.has("from") && !from) || (search.has("to") && !to) ||
    (from && to && from > to) || (cursor && !/^[a-z0-9]{1,40}$/.test(cursor))) {
    return reply({ message: "Choose a valid date range or reload the updates." }, 400);
  }

  const [updates, options] = await Promise.all([
    prisma.workshopDailyUpdate.findMany({
      where: { workDate: { gte: from ?? undefined, lte: to ?? undefined } },
      orderBy: [{ workDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: updateSelect
    }),
    !cursor && canAccess(auth.user.role, "workshop-updates:post") ? loadOptions() : null
  ]);
  return reply({ updates: updates.slice(0, PAGE_SIZE), nextCursor: updates[PAGE_SIZE] ? updates[PAGE_SIZE - 1].id : null, options });
}

async function loadOptions() {
  const [rigs, jobs] = await Promise.all([
    prisma.rig.findMany({ orderBy: { rigCode: "asc" }, select: { id: true, rigCode: true } }),
    prisma.maintenanceRequest.findMany({
      orderBy: [{ requestDate: "desc" }, { id: "desc" }],
      take: 100,
      select: { id: true, requestCode: true, rigId: true, rig: { select: { rigCode: true } } }
    })
  ]);
  return { rigs, jobs };
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request, "workshop-updates:post");
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reply({ message: "Enter a workshop update." }, 400);
  }

  const workDate = parseWorkDate(body.workDate);
  const workDone = readText(body.workDone);
  const blockers = readText(body.blockers);
  const nextSteps = readText(body.nextSteps);
  const rigId = readText(body.rigId);
  const maintenanceRequestId = readText(body.maintenanceRequestId);
  if (!workDate || !workDone || [workDone, blockers, nextSteps].some((value) => value.length > TEXT_LIMIT)) {
    return reply({ message: "Enter a work date and describe what you worked on. Each note can be up to 2,000 characters." }, 400);
  }

  const [rig, job] = await Promise.all([
    rigId ? prisma.rig.findUnique({ where: { id: rigId }, select: { id: true } }) : null,
    maintenanceRequestId ? prisma.maintenanceRequest.findUnique({
      where: { id: maintenanceRequestId }, select: { id: true, rigId: true }
    }) : null
  ]);
  if ((rigId && !rig) || (maintenanceRequestId && !job) || (rig && job && job.rigId !== rig.id)) {
    return reply({ message: "Select an existing rig and a maintenance job for that same rig." }, 400);
  }

  try {
    const update = await prisma.workshopDailyUpdate.create({
      data: {
        authorId: auth.user.id, workDate, workDone, blockers: blockers || null, nextSteps: nextSteps || null,
        rigId: job?.rigId ?? rig?.id, maintenanceRequestId: job?.id
      },
      select: updateSelect
    });
    return reply({ update }, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return reply({ message: "A linked record changed. Reload and try again." }, 409);
    }
    throw error;
  }
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseWorkDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return null;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}
