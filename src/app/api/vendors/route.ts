import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import {
  namesMatchNormalized,
  normalizeNameForComparison,
  normalizeNameForStorage
} from "@/lib/name-normalization";
import { prisma } from "@/lib/prisma";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

export async function GET(request: NextRequest) {
  const auth = await requireAnyApiPermission(request, ["expenses:manual", "inventory:view"]);
  if (!auth.ok) {
    return auth.response;
  }

  const search = request.nextUrl.searchParams.get("search") || "";
  const normalizedSearch = normalizeNameForComparison(search);
  const sanitizedSearch = normalizeNameForStorage(search);
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  const vendors = await prisma.inventorySupplier.findMany({
    where: {
      isActive: true,
      ...(sanitizedSearch
        ? {
            name: {
              contains: sanitizedSearch,
              mode: "insensitive"
            }
          }
        : {})
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      notes: true,
      contactPerson: true,
      phone: true
    }
  });

  const filtered =
    normalizedSearch.length === 0
      ? vendors
      : vendors.filter((vendor) =>
          normalizeNameForComparison(vendor.name).includes(normalizedSearch)
        );

  return NextResponse.json({
    data: filtered.slice(0, limit).map((vendor) => serializeVendor(vendor))
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAnyApiPermission(request, ["expenses:manual", "inventory:manage"]);
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = normalizeNameForStorage(typeof body?.name === "string" ? body.name : "");
  const source = parseSource(body?.source);

  if (!name) {
    return NextResponse.json({ message: "Vendor name is required." }, { status: 400 });
  }

  const existingCandidates = await prisma.inventorySupplier.findMany({
    select: {
      id: true,
      name: true,
      notes: true,
      contactPerson: true,
      phone: true,
      isActive: true
    }
  });
  const existing = existingCandidates.find((vendor) =>
    namesMatchNormalized(vendor.name, name)
  );

  if (existing) {
    const activeVendor = existing.isActive
      ? existing
      : await prisma.inventorySupplier.update({
          where: { id: existing.id },
          data: { isActive: true },
          select: {
            id: true,
            name: true,
            notes: true,
            contactPerson: true,
            phone: true,
            isActive: true
          }
        });

    return NextResponse.json({
      data: serializeVendor(activeVendor),
      created: false
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    const inserted = await tx.inventorySupplier.create({
      data: {
        name,
        isActive: true,
        notes:
          source === "request_flow"
            ? "Profile state: BASIC_INCOMPLETE | Source: request_flow"
            : null
      },
      select: {
        id: true,
        name: true,
        notes: true,
        contactPerson: true,
        phone: true,
        isActive: true,
        createdAt: true
      }
    });

    await recordAuditLog({
      db: tx,
      module: "inventory",
      entityType: "inventory_supplier",
      entityId: inserted.id,
      action: source === "request_flow" ? "create_from_request_flow" : "create",
      description:
        source === "request_flow"
          ? `${auth.session.name} created vendor ${inserted.name} from request flow.`
          : `${auth.session.name} created vendor ${inserted.name}.`,
      after: {
        id: inserted.id,
        name: inserted.name,
        source,
        profileState: source === "request_flow" ? "BASIC_INCOMPLETE" : "STANDARD"
      },
      actor: auditActorFromSession(auth.session)
    });

    return inserted;
  });

  return NextResponse.json(
    {
      data: serializeVendor(created),
      created: true
    },
    { status: 201 }
  );
}

function parseSource(value: unknown) {
  if (value === "setup") {
    return "setup" as const;
  }
  return "request_flow" as const;
}

function parseLimit(value: string | null) {
  if (!value) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }
  const normalized = Math.floor(parsed);
  if (normalized <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(normalized, MAX_LIMIT);
}

function serializeVendor(vendor: {
  id: string;
  name: string;
  notes: string | null;
  contactPerson: string | null;
  phone: string | null;
}) {
  const details = extractVendorDetails(vendor.notes);
  const additionalInfo =
    details.location ||
    details.type ||
    vendor.contactPerson?.trim() ||
    vendor.phone?.trim() ||
    null;

  return {
    id: vendor.id,
    name: vendor.name,
    location: details.location,
    type: details.type,
    additionalInfo
  };
}

function extractVendorDetails(notes: string | null) {
  const cleanNotes = notes?.trim() || "";
  if (!cleanNotes) {
    return {
      location: null,
      type: null
    };
  }

  const location = extractDetail(cleanNotes, "location");
  const type = extractDetail(cleanNotes, "type");

  return {
    location,
    type
  };
}

function extractDetail(notes: string, label: string) {
  const pattern = new RegExp(`${label}\\s*:\\s*([^|,;\\n]+)`, "i");
  const match = notes.match(pattern);
  return match?.[1]?.trim() || null;
}
