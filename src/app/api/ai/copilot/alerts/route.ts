import type { UserRole } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import {
  buildAlertCopilotInsights,
  type AlertCopilotMode,
  type AlertOwnerCandidate
} from "@/lib/ai/manager-copilot";
import type { AlertsCenterRow } from "@/lib/alerts-center";
import { requireApiPermission } from "@/lib/auth/api-guard";

interface AlertCopilotRequestBody {
  mode?: AlertCopilotMode;
  alerts?: AlertsCenterRow[];
  owners?: AlertOwnerCandidate[];
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  if (!isManagerOrAdmin(auth.session.role)) {
    return NextResponse.json(
      { message: "Forbidden: Alerts AI Copilot is available to ADMIN and MANAGER roles only." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as AlertCopilotRequestBody | null;
  const mode = body?.mode;
  if (!mode) {
    return NextResponse.json({ message: "mode is required." }, { status: 400 });
  }

  const alerts = Array.isArray(body?.alerts) ? body.alerts.filter(Boolean).slice(0, 200) : [];
  const owners = Array.isArray(body?.owners) ? body.owners.filter(Boolean) : [];

  const insights = buildAlertCopilotInsights({
    alerts,
    owners
  });

  return NextResponse.json({
    ok: true,
    advisoryOnly: true,
    mode,
    generatedAt: new Date().toISOString(),
    insights
  });
}

function isManagerOrAdmin(role: UserRole) {
  return role === "ADMIN" || role === "MANAGER";
}
