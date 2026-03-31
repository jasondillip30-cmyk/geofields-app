import { NextResponse, type NextRequest } from "next/server";

import {
  buildContextualCopilotResponse,
  type ContextualCopilotRequestBody
} from "@/lib/ai/contextual-copilot";
import { fallbackCopilotContext, normalizeCopilotContext } from "@/lib/ai/contextual-copilot-context";
import { getSessionFromRequest } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ContextualCopilotRequestBody | null;
  const question = body?.question?.trim();
  if (!question) {
    return NextResponse.json({ message: "question is required." }, { status: 400 });
  }

  const context = normalizeCopilotContext(body?.context || fallbackCopilotContext);
  context.viewerRole = session.role;
  const data = buildContextualCopilotResponse({
    question,
    context
  });

  return NextResponse.json({
    ok: true,
    advisoryOnly: true,
    generatedAt: new Date().toISOString(),
    data
  });
}
