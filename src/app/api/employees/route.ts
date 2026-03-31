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

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "employees:view");
  if (!auth.ok) {
    return auth.response;
  }

  const employees = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      phone: true,
      title: true,
      profileImageUrl: true,
      currentAssignment: true,
      createdAt: true
    }
  });

  return NextResponse.json({ data: employees });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "employees:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!fullName || !email || password.length < 8) {
    return NextResponse.json(
      { message: "fullName, email, and password (min 8 chars) are required." },
      { status: 400 }
    );
  }

  const role = parseRole(body?.role);
  const roleRef = await prisma.role.findUnique({
    where: { name: role }
  });

  const created = await prisma.user.create({
    data: {
      fullName,
      email,
      role,
      roleId: roleRef?.id ?? null,
      passwordHash: await hash(password, 10),
      phone: typeof body?.phone === "string" ? body.phone.trim() : null,
      title: typeof body?.title === "string" ? body.title.trim() : null,
      profileImageUrl: typeof body?.profileImageUrl === "string" ? body.profileImageUrl.trim() : null,
      currentAssignment: typeof body?.currentAssignment === "string" ? body.currentAssignment.trim() : null,
      isActive: body?.isActive !== false
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

  return NextResponse.json({ data: created }, { status: 201 });
}
