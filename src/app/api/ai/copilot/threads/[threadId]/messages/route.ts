import { NextResponse, type NextRequest } from "next/server";

import {
  buildContextualCopilotResponse,
  type ContextualCopilotRequestBody
} from "@/lib/ai/contextual-copilot";
import { fallbackCopilotContext, normalizeCopilotContext } from "@/lib/ai/contextual-copilot-context";
import {
  buildThreadTitleFromQuestion,
  mapIntentToDb,
  mapRoleToDb,
  mapScopeToDb,
  mergeThreadConversationContext,
  normalizeScopeMode,
  toMessageDto,
  toThreadSummaryDto
} from "@/lib/ai/copilot-chat";
import { getSessionFromRequest } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export async function POST(
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
    select: {
      id: true,
      title: true,
      scopeMode: true,
      userId: true,
      createdAt: true,
      updatedAt: true,
      currentPageKey: true,
      _count: {
        select: { messages: true }
      }
    }
  });

  if (!thread) {
    return NextResponse.json({ message: "Chat thread not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | (ContextualCopilotRequestBody & { scopeMode?: string })
    | null;
  const question = body?.question?.trim();
  if (!question) {
    return NextResponse.json({ message: "question is required." }, { status: 400 });
  }

  const requestedScopeMode = normalizeScopeMode(body?.scopeMode || thread.scopeMode);
  const baseContext = normalizeCopilotContext(body?.context || fallbackCopilotContext);
  const context = {
    ...baseContext,
    viewerRole: session.role,
    scopeMode: requestedScopeMode
  };

  const previousMessages = await prisma.copilotChatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "desc" },
    take: 30
  });

  const mergedContext = mergeThreadConversationContext({
    context,
    previousMessages: previousMessages.reverse().map(toMessageDto)
  });

  const responseData = buildContextualCopilotResponse({
    question,
    context: mergedContext
  });

  const payloadContextSnapshot = JSON.stringify({
    pageKey: mergedContext.pageKey,
    pageName: mergedContext.pageName,
    scopeMode: mergedContext.scopeMode,
    sourcePageKeys: mergedContext.sourcePageKeys || [],
    filters: mergedContext.filters
  });

  const result = await prisma.$transaction(async (tx) => {
    const userMessage = await tx.copilotChatMessage.create({
      data: {
        threadId: thread.id,
        role: mapRoleToDb("user"),
        content: question,
        pageKey: mergedContext.pageKey || null,
        scopeMode: mapScopeToDb(requestedScopeMode),
        contextJson: payloadContextSnapshot
      }
    });

    const shouldAutoTitle = thread.title.trim().toLowerCase() === "new chat" && thread._count.messages === 0;
    const nextTitle = shouldAutoTitle ? buildThreadTitleFromQuestion(question) : thread.title;

    await tx.copilotChatThread.update({
      where: { id: thread.id },
      data: {
        title: nextTitle,
        scopeMode: mapScopeToDb(requestedScopeMode),
        currentPageKey: mergedContext.pageKey || null
      }
    });

    const assistantMessage = await tx.copilotChatMessage.create({
      data: {
        threadId: thread.id,
        role: mapRoleToDb("assistant"),
        intent: mapIntentToDb(responseData.intent),
        content: responseData.answer,
        pageKey: mergedContext.pageKey || null,
        scopeMode: mapScopeToDb(requestedScopeMode),
        contextJson: payloadContextSnapshot,
        responseDataJson: JSON.stringify(responseData)
      }
    });

    return { userMessage, assistantMessage };
  });

  const refreshedThread = await prisma.copilotChatThread.findUnique({
    where: { id: thread.id },
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
    advisoryOnly: true,
    data: {
      thread: refreshedThread
        ? toThreadSummaryDto({
            thread: refreshedThread,
            messageCount: refreshedThread._count.messages,
            lastMessage: refreshedThread.messages[0] || null
          })
        : null,
      userMessage: toMessageDto(result.userMessage),
      assistantMessage: toMessageDto(result.assistantMessage)
    }
  });
}
