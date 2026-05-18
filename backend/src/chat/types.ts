import type { UploadedFileInput } from "../validation.js";

export type ChatMessageRole = "user" | "assistant";
export type ChatAttachmentKind = "model" | "texture";
export type ToolCallStatus = "loading" | "success" | "error";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  createdAt: number;
}

export interface ChatAttachment extends UploadedFileInput {
  id: string;
  kind: ChatAttachmentKind;
  extension: string;
  createdAt: number;
}

export interface ToolCallLogEntry {
  id: string;
  toolName: string;
  arguments: unknown;
  status: ToolCallStatus;
  result?: string;
  error?: string;
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  toolSummaries: string[];
  attachments: ChatAttachment[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatToolContext {
  session: ChatSession;
}

export interface ChatToolResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

export interface ChatResponsePayload {
  ok: true;
  sessionId: string;
  message: string;
  messages: ChatMessage[];
  toolCalls: ToolCallLogEntry[];
  attachments: ChatAttachmentSummary[];
}

export interface ChatAttachmentSummary {
  id: string;
  kind: ChatAttachmentKind;
  originalName: string;
  sizeBytes: number;
  extension: string;
}

export interface OpenAIResponseOutputItem {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

export interface OpenAIResponse {
  id: string;
  output?: OpenAIResponseOutputItem[];
  output_text?: string;
  error?: {
    message?: string;
  } | null;
}
