import { hash } from "bcryptjs";
import { UserRole } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { prisma } from "@/lib/prisma";

function parseRole(value: unknown): UserRole {
  if (typeof value !== "string") {
    return UserRole.FIELD;
  }
  const upper = value.toUpperCase();
  if (upper in UserRole) {
    return UserRole[upper as keyof typeof UserRole];
  }
  return UserRole.FIELD;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const auth = await requireApiPermission(request, "employees:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { employeeId } = await params;
  const body = await request.json().catch(() => null);
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!fullName || !email) {
    return NextResponse.json({ message: "fullName and email are required." }, { status: 400 });
  }

  const role = parseRole(body?.role);
  const roleRef = await prisma.role.findUnique({
    where: { name: role }
  });

  const updated = await prisma.user.update({
    where: { id: employeeId },
    data: {
      fullName,
      email,
      role,
      roleId: roleRef?.id ?? null,
      phone: typeof body?.phone === "string" ? body.phone.trim() : null,
      title: typeof body?.title === "string" ? body.title.trim() : null,
      profileImageUrl: typeof body?.profileImageUrl === "string" ? body.profileImageUrl.trim() : null,
      currentAssignment: typeof body?.currentAssignment === "string" ? body.currentAssignment.trim() : null,
      isActive: body?.isActive !== false,
      ...(typeof body?.password === "string" && body.password.length >= 8
        ? { passwordHash: await hash(body.password, 10) }
        : {})
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      phone: true,
      title: true,
      profileImageUrl: true,
      currentAssignment: true
    }
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const auth = await requireApiPermission(request, "employees:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { employeeId } = await params;
  await prisma.user.delete({ where: { id: employeeId } });
  return NextResponse.json({ ok: true });
}
