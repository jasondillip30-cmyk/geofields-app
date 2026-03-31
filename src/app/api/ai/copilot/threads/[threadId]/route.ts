import { NextResponse, type NextRequest } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import {
  normalizeScopeMode,
  toMessageDto,
  toThreadSummaryDto,
  mapScopeToDb
} from "@/lib/ai/copilot-chat";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;
  if (!threadId) {
    return NextResponse.json({ message: "threadId is required." }, { status: 400 });
  }

  const thread = await prisma.copilotChatThread.findFirst({
    where: {
      id: threadId,
      userId: session.userId
    },
    include: {
      messages: {
        orderBy: { createdAt: "asc" }
      },
      _count: {
        select: { messages: true }
      }
    }
  });

  if (!thread) {
    return NextResponse.json({ message: "Chat thread not found." }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      thread: toThreadSummaryDto({
        thread,
        messageCount: thread._count.messages,
        lastMessage: thread.messages[thread.messages.length - 1] || null
      }),
      messages: thread.messages.map(toMessageDto)
    }
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;
  if (!threadId) {
    return NextResponse.json({ message: "threadId is required." }, { status: 400 });
  }

  const existing = await prisma.copilotChatThread.findFirst({
    where: {
      id: threadId,
      userId: session.userId
    }
  });

  if (!existing) {
    return NextResponse.json({ message: "Chat thread not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        title?: string;
        scopeMode?: string;
        currentPageKey?: string | null;
      }
    | null;

  const title =
    typeof body?.title === "string"
      ? body.title.trim().slice(0, 120)
      : undefined;
  const scopeMode =
    typeof body?.scopeMode === "string" ? normalizeScopeMode(body.scopeMode) : undefined;
  const currentPageKey =
    typeof body?.currentPageKey === "string"
      ? body.currentPageKey.trim().slice(0, 80) || null
      : body?.currentPageKey === null
        ? null
        : undefined;

  if (title !== undefined && !title) {
    return NextResponse.json({ message: "title cannot be empty." }, { status: 400 });
  }

  const updated = await prisma.copilotChatThread.update({
    where: { id: threadId },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(scopeMode !== undefined ? { scopeMode: mapScopeToDb(scopeMode) } : {}),
      ...(currentPageKey !== undefined ? { currentPageKey } : {})
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

  return NextResponse.json({
    data: toThreadSummaryDto({
      thread: updated,
      messageCount: updated._count.messages,
      lastMessage: updated.messages[0] || null
    })
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;
  if (!threadId) {
    return NextResponse.json({ message: "threadId is required." }, { status: 400 });
  }

  const existing = await prisma.copilotChatThread.findFirst({
    where: {
      id: threadId,
      userId: session.userId
    },
    select: { id: true }
  });

  if (!existing) {
    return NextResponse.json({ message: "Chat thread not found." }, { status: 404 });
  }

  await prisma.copilotChatThread.delete({ where: { id: threadId } });
  return NextResponse.json({ ok: true });
}
