import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const auth = await requireApiPermission(request, "clients:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { clientId } = await params;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ message: "Client name is required." }, { status: 400 });
  }

  const existing = await prisma.client.findUnique({ where: { id: clientId } });
  if (!existing) {
    return NextResponse.json({ message: "Client not found." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.client.update({
      where: { id: clientId },
      data: {
        name,
        contactPerson: typeof body?.contactPerson === "string" ? body.contactPerson.trim() : null,
        email: typeof body?.email === "string" ? body.email.trim().toLowerCase() : null,
        phone: typeof body?.phone === "string" ? body.phone.trim() : null,
        description: typeof body?.description === "string" ? body.description.trim() : null,
        address: typeof body?.address === "string" ? body.address.trim() : null,
        logoUrl: typeof body?.logoUrl === "string" ? body.logoUrl.trim() : null,
        profilePhotoUrl: typeof body?.profilePhotoUrl === "string" ? body.profilePhotoUrl.trim() : null
      }
    });

    await recordAuditLog({
      db: tx,
      module: "clients",
      entityType: "client",
      entityId: clientId,
      action: "edit",
      description: `${auth.session.name} updated Client ${next.name}.`,
      before: clientAuditSnapshot(existing),
      after: clientAuditSnapshot(next),
      actor: auditActorFromSession(auth.session)
    });

    return next;
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const auth = await requireApiPermission(request, "clients:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { clientId } = await params;
  const existing = await prisma.client.findUnique({ where: { id: clientId } });
  if (!existing) {
    return NextResponse.json({ message: "Client not found." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.client.delete({
      where: { id: clientId }
    });

    await recordAuditLog({
      db: tx,
      module: "clients",
      entityType: "client",
      entityId: clientId,
      action: "delete",
      description: `${auth.session.name} deleted Client ${existing.name}.`,
      before: clientAuditSnapshot(existing),
      actor: auditActorFromSession(auth.session)
    });
  });

  return NextResponse.json({ ok: true });
}

function clientAuditSnapshot(client: {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}) {
  return {
    id: client.id,
    name: client.name,
    contactPerson: client.contactPerson,
    email: client.email,
    phone: client.phone,
    address: client.address
  };
}
