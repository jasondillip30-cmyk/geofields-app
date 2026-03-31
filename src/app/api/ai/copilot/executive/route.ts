import { NextResponse, type NextRequest } from "next/server";

import {
  buildExecutiveCopilotSummary,
  type ExecutiveCopilotContext
} from "@/lib/ai/manager-copilot";
import { requireApiPermission } from "@/lib/auth/api-guard";

interface ExecutiveCopilotRequestBody {
  context?: ExecutiveCopilotContext;
  question?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as ExecutiveCopilotRequestBody | null;
  if (!body?.context) {
    return NextResponse.json({ message: "context is required." }, { status: 400 });
  }

  const output = buildExecutiveCopilotSummary({
    context: body.context,
    question: body.question?.trim() || undefined
  });

  return NextResponse.json({
    ok: true,
    advisoryOnly: true,
    generatedAt: output.generatedAt,
    data: output
  });
}
