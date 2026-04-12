import type { CopilotIntent, ContextualCopilotResponsePayload } from "@/lib/ai/contextual-copilot";

export type CopilotScopeMode = "THIS_PAGE" | "RELATED_DATA" | "WHOLE_APP";

export interface CopilotMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  intent?: CopilotIntent | null;
  createdAt?: string;
  responseData?: ContextualCopilotResponsePayload | null;
}

export interface CopilotThreadSummary {
  id: string;
  title: string;
  scopeMode: CopilotScopeMode;
  currentPageKey: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string | null;
}
