import { UrgencyLevel } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { prisma } from "@/lib/prisma";

function parseSeverity(value: unknown): UrgencyLevel {
  if (typeof value !== "string") {
    return UrgencyLevel.MEDIUM;
  }

  const upper = value.toUpperCase();
  if (upper in UrgencyLevel) {
    return UrgencyLevel[upper as keyof typeof UrgencyLevel];
  }
  return UrgencyLevel.MEDIUM;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "breakdowns:view");
  if (!auth.ok) {
    return auth.response;
  }

  const records = await prisma.breakdownReport.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { name: true } },
      project: { select: { name: true } },
      rig: { select: { rigCode: true } },
      reportedBy: { select: { fullName: true, role: true } }
    }
  });

  return NextResponse.json({ data: records });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "breakdowns:submit");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const selectedRigId = typeof body?.rigId === "string" ? body.rigId : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";

  if (!projectId || !title || !description) {
    return NextResponse.json(
      { message: "projectId, title, and description are required." },
      { status: 400 }
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      clientId: true,
      assignedRigId: true
    }
  });

  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }

  const rigId = selectedRigId || project.assignedRigId;
  if (!rigId) {
    return NextResponse.json(
      { message: "No rig linked to this project. Select a rig before submitting breakdown." },
      { status: 400 }
    );
  }

  const created = await prisma.breakdownReport.create({
    data: {
      projectId: project.id,
      clientId: project.clientId,
      rigId,
      reportedById: auth.session.userId,
      title,
      description,
      severity: parseSeverity(body?.severity),
      downtimeHours: Number(body?.downtimeHours ?? 0),
      status: "SUBMITTED",
      photoUrls: typeof body?.photoUrls === "string" ? body.photoUrls : null
    }
  });

  return NextResponse.json({ data: created }, { status: 201 });
}
