import { hash } from "bcryptjs";
import { UserRole } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditSafetyReviewerChange, EmployeeAccessError, employeeAccessFailure, lockEmployeeAccess, resolveSafetyReviewerFlag } from "@/lib/employee-reviewer-access";
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
  try {
    const [roleRef, passwordHash] = await Promise.all([
      prisma.role.findUnique({ where: { name: role } }),
      typeof body?.password === "string" && body.password.length >= 8 ? hash(body.password, 10) : undefined
    ]);
    const updated = await prisma.$transaction(async (tx) => {
      const { actor, target } = await lockEmployeeAccess(tx, auth.session.userId, employeeId);
      if (!target) throw new EmployeeAccessError("Employee not found.", 404);
      const isActive = body?.isActive !== false;
      const isSafetyReviewer = resolveSafetyReviewerFlag(body?.isSafetyReviewer, role, isActive, target.isSafetyReviewer);
      const employee = await tx.user.update({
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
          isActive,
          isSafetyReviewer,
          ...(passwordHash ? { passwordHash } : {})
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          isActive: true,
          isSafetyReviewer: true,
          phone: true,
          title: true,
          profileImageUrl: true,
          currentAssignment: true
        }
      });
      await auditSafetyReviewerChange(tx, actor, employeeId, target.isSafetyReviewer, employee.isSafetyReviewer);
      return employee;
    });
    return NextResponse.json({ data: updated });
  } catch (error) { return employeeAccessFailure(error); }
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
  try {
    await prisma.$transaction(async (tx) => {
      const { target } = await lockEmployeeAccess(tx, auth.session.userId, employeeId);
      if (!target) throw new EmployeeAccessError("Employee not found.", 404);
      if (target.isSafetyReviewer) throw new EmployeeAccessError("Remove safety reviewer access before deleting this employee.", 409);
      await tx.user.delete({ where: { id: employeeId } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return employeeAccessFailure(error); }
}
