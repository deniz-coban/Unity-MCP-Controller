import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { unityConfig } from "../config.js";
import type {
  ChatAttachment,
  ChatAttachmentSummary,
  ChatMessage,
  ChatSession
} from "./types.js";

const sessions = new Map<string, ChatSession>();

const attachmentTtlMs = unityConfig.chat.attachmentTtlMinutes * 60 * 1000;
const sessionTtlMs = Math.max(attachmentTtlMs, 6 * 60 * 60 * 1000);

const now = (): number => Date.now();

const trimMessages = (messages: ChatMessage[]): ChatMessage[] =>
  messages.slice(-unityConfig.chat.historyMaxItems);

const cleanupAttachmentFile = (attachment: ChatAttachment) => {
  fs.unlink(attachment.path).catch(() => undefined);
};

export const summarizeAttachment = (
  attachment: ChatAttachment
): ChatAttachmentSummary => ({
  id: attachment.id,
  kind: attachment.kind,
  originalName: attachment.originalname,
  sizeBytes: attachment.size,
  extension: attachment.extension
});

export const getOrCreateChatSession = (sessionId?: string): ChatSession => {
  cleanupExpiredChatSessions();

  const id = sessionId?.trim() || randomUUID();
  const existing = sessions.get(id);

  if (existing) {
    existing.updatedAt = now();
    return existing;
  }

  const session: ChatSession = {
    id,
    messages: [],
    toolSummaries: [],
    attachments: [],
    createdAt: now(),
    updatedAt: now()
  };

  sessions.set(id, session);
  return session;
};

export const addChatMessage = (
  session: ChatSession,
  role: ChatMessage["role"],
  content: string
): ChatMessage => {
  const message: ChatMessage = {
    id: randomUUID(),
    role,
    content,
    createdAt: now()
  };

  session.messages = trimMessages([...session.messages, message]);
  session.updatedAt = now();
  return message;
};

export const addToolSummary = (session: ChatSession, summary: string) => {
  session.toolSummaries = [...session.toolSummaries, summary].slice(-8);
  session.updatedAt = now();
};

export const addChatAttachment = (
  session: ChatSession,
  attachment: Omit<ChatAttachment, "id" | "createdAt">
): ChatAttachment => {
  const storedAttachment: ChatAttachment = {
    ...attachment,
    id: randomUUID(),
    createdAt: now()
  };

  session.attachments.push(storedAttachment);
  session.updatedAt = now();
  return storedAttachment;
};

export const getChatAttachment = (
  session: ChatSession,
  attachmentId: string | undefined
): ChatAttachment | undefined => {
  if (!attachmentId) {
    return undefined;
  }

  cleanupExpiredChatSessions();
  return session.attachments.find((attachment) => attachment.id === attachmentId);
};

export const listChatAttachments = (
  session: ChatSession
): ChatAttachmentSummary[] => {
  cleanupExpiredChatSessions();
  return session.attachments.map(summarizeAttachment);
};

export const cleanupExpiredChatSessions = () => {
  const currentTime = now();

  for (const [sessionId, session] of sessions) {
    const activeAttachments = session.attachments.filter((attachment) => {
      const isExpired = currentTime - attachment.createdAt > attachmentTtlMs;

      if (isExpired) {
        cleanupAttachmentFile(attachment);
      }

      return !isExpired;
    });

    session.attachments = activeAttachments;

    if (
      currentTime - session.updatedAt > sessionTtlMs &&
      session.attachments.length === 0
    ) {
      sessions.delete(sessionId);
    }
  }
};
