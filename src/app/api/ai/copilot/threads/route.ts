import { NextResponse, type NextRequest } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import {
  normalizeScopeMode,
  toThreadSummaryDto,
  mapScopeToDb
} from "@/lib/ai/copilot-chat";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const threads = await prisma.copilotChatThread.findMany({
    where: { userId: session.userId },
    orderBy: { updatedAt: "desc" },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1
      },
      _count: {
        select: { messages: true }
      }
    }
  });

  return NextResponse.json({
    data: threads.map((thread) =>
      toThreadSummaryDto({
        thread,
        messageCount: thread._count.messages,
        lastMessage: thread.messages[0] || null
      })
    )
  });
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        title?: string;
        scopeMode?: string;
        currentPageKey?: string | null;
      }
    | null;

  const title = (body?.title || "").trim() || "New chat";
  const scopeMode = normalizeScopeMode(body?.scopeMode);
  const currentPageKey = body?.currentPageKey?.trim() || null;

  const created = await prisma.copilotChatThread.create({
    data: {
      userId: session.userId,
      title,
      scopeMode: mapScopeToDb(scopeMode),
      currentPageKey
    },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1
      },
      _count: {
        select: { messages: true }
      }
    }
  });

  return NextResponse.json(
    {
      data: toThreadSummaryDto({
        thread: created,
        messageCount: created._count.messages,
        lastMessage: created.messages[0] || null
      })
    },
    { status: 201 }
  );
}
