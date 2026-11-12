import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { canAccess } from "@/lib/auth/permissions";
import { changeProjectOperatingCosts, OperatingCostError, readProjectOperatingCosts } from "@/lib/project-operating-costs";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ projectId: string }> };

async function authorize(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:edit");
  if (!auth.ok) return auth;
  const user = await prisma.user.findUnique({
    where: { id: auth.session.userId }, select: { fullName: true, role: true, isActive: true }
  });
  if (!user?.isActive || !canAccess(user.role, "finance:edit")) {
    return { ok: false as const, response: NextResponse.json({ message: "Operating costs require active finance edit access." }, { status: 403 }) };
  }
  return { ok: true as const, session: { ...auth.session, name: user.fullName, role: user.role } };
}

function responseError(error: unknown) {
  if (error instanceof OperatingCostError) return NextResponse.json({ message: error.message }, { status: error.status });
  throw error;
}

export async function GET(request: NextRequest, { params }: Context) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { projectId } = await params;
  if (!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }
  const month = request.nextUrl.searchParams.get("month") || new Date().toISOString().slice(0, 7);
  try {
    const result = await readProjectOperatingCosts(projectId, month);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { projectId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ message: "Invalid operating cost request." }, { status: 400 });
  }
  try {
    return NextResponse.json(await changeProjectOperatingCosts(projectId, auth.session, body));
  } catch (error) {
    return responseError(error);
  }
}
