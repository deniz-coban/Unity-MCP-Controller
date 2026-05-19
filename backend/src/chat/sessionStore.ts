import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { unityConfig } from "../config.js";
import type {
  ChatAttachment,
  ChatAttachmentSummary,
  ChatMessage,
  ChatSession,
  PendingConfirmation
} from "./types.js";

const sessions = new Map<string, ChatSession>();

const attachmentTtlMs = unityConfig.chat.attachmentTtlMinutes * 60 * 1000;
const sessionTtlMs = Math.max(attachmentTtlMs, 6 * 60 * 60 * 1000);
const pendingConfirmationTtlMs = 5 * 60 * 1000;

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
    pendingConfirmations: new Map(),
    createdAt: now(),
    updatedAt: now()
  };

  sessions.set(id, session);
  return session;
};

export const recordPendingConfirmation = (
  session: ChatSession,
  entry: Omit<PendingConfirmation, "key" | "expiresAt"> & { key: string }
): PendingConfirmation => {
  const confirmation: PendingConfirmation = {
    ...entry,
    expiresAt: now() + pendingConfirmationTtlMs
  };
  session.pendingConfirmations.set(confirmation.key, confirmation);
  session.updatedAt = now();
  return confirmation;
};

export const peekPendingConfirmation = (
  session: ChatSession,
  key: string
): PendingConfirmation | undefined => {
  const entry = session.pendingConfirmations.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt < now()) {
    session.pendingConfirmations.delete(key);
    return undefined;
  }
  return entry;
};

export const consumePendingConfirmation = (
  session: ChatSession,
  key: string
):
  | { ok: true; confirmation: PendingConfirmation }
  | { ok: false; reason: "missing" | "expired" } => {
  const entry = session.pendingConfirmations.get(key);
  if (!entry) {
    return { ok: false, reason: "missing" };
  }
  if (entry.expiresAt < now()) {
    session.pendingConfirmations.delete(key);
    return { ok: false, reason: "expired" };
  }
  session.pendingConfirmations.delete(key);
  session.updatedAt = now();
  return { ok: true, confirmation: entry };
};

export const listPendingConfirmations = (
  session: ChatSession
): PendingConfirmation[] => {
  const currentTime = now();
  const live: PendingConfirmation[] = [];
  for (const [key, entry] of session.pendingConfirmations) {
    if (entry.expiresAt < currentTime) {
      session.pendingConfirmations.delete(key);
    } else {
      live.push(entry);
    }
  }
  return live;
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

    for (const [key, entry] of session.pendingConfirmations) {
      if (entry.expiresAt < currentTime) {
        session.pendingConfirmations.delete(key);
      }
    }

    if (
      currentTime - session.updatedAt > sessionTtlMs &&
      session.attachments.length === 0 &&
      session.pendingConfirmations.size === 0
    ) {
      sessions.delete(sessionId);
    }
  }
};
