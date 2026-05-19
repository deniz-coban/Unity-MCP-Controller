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

export type PendingConfirmationKind =
  | "delete_object"
  | "delete_objects"
  | "select_model";

export interface PendingConfirmationTarget {
  instanceId: number;
  name: string;
  category: string;
}

export interface PendingConfirmationOption {
  key: string;
  label: string;
  description: string;
  thumbnailUrl?: string;
  metaLabel?: string;
  // Source-private metadata used by the route handler to perform the action
  // when the user picks this option. Opaque to the frontend.
  metadata?: unknown;
}

export interface PendingConfirmation {
  key: string;
  kind: PendingConfirmationKind;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  targets: PendingConfirmationTarget[];
  truncatedTargetCount: number;
  expiresAt: number;
  options?: PendingConfirmationOption[];
  // Free-form context the route handler reads on confirm (e.g. import params
  // captured at search time so the user can say "add a bicycle at (5,0,0)").
  context?: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  toolSummaries: string[];
  attachments: ChatAttachment[];
  pendingConfirmations: Map<string, PendingConfirmation>;
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

export interface ChatStatusNote {
  kind: "no_assistant_output";
  text: string;
}

export interface ChatResponsePayload {
  ok: true;
  sessionId: string;
  message: string;
  messages: ChatMessage[];
  toolCalls: ToolCallLogEntry[];
  attachments: ChatAttachmentSummary[];
  statusNote?: ChatStatusNote;
  pendingConfirmations: PendingConfirmation[];
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
