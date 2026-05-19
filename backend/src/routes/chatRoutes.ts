import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { unityConfig } from "../config.js";
import { sendChatMessage } from "../chat/chatService.js";
import {
  addChatAttachment,
  addToolSummary,
  consumePendingConfirmation,
  getOrCreateChatSession,
  listChatAttachments,
  listPendingConfirmations,
  summarizeAttachment
} from "../chat/sessionStore.js";
import { unityClient } from "../unityClient.js";
import {
  supportedModelExtensions,
  supportedTextureExtensions
} from "../validation.js";
import type { ChatAttachmentKind, ChatResponsePayload } from "../chat/types.js";
import { downloadCandidateToTemp } from "../online/download.js";
import { validateImportModelPayload } from "../validation.js";
import type {
  ImportModelPayload,
  OnlineModelCandidate,
  UnityActionErrorResponse,
  UnityActionResponse,
  Vector3
} from "../types.js";

export const chatRoutes = Router();

const uploadTempDir = path.join(os.tmpdir(), "unity-mcp-controller-chat-uploads");
const maxUploadSizeMb = Math.max(
  unityConfig.modelUploadMaxMb,
  unityConfig.textureUploadMaxMb
);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdirSync(uploadTempDir, { recursive: true });
      callback(null, uploadTempDir);
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      callback(null, `chat-${suffix}${extension}`);
    }
  }),
  limits: {
    fileSize: Math.floor(maxUploadSizeMb * 1024 * 1024)
  }
});

const uploadedFileKind = (
  file: Express.Multer.File
): { ok: true; kind: ChatAttachmentKind; extension: string } | { ok: false; error: string } => {
  const extension = path.extname(path.basename(file.originalname)).toLowerCase();

  if (supportedModelExtensions.includes(extension as never)) {
    return { ok: true, kind: "model", extension };
  }

  if (supportedTextureExtensions.includes(extension as never)) {
    return { ok: true, kind: "texture", extension };
  }

  return {
    ok: false,
    error: "Attachment must be a .fbx, .obj, .png, .jpg, or .jpeg file."
  };
};

const multerErrorDetails = (uploadError: unknown): string[] => {
  if (uploadError instanceof multer.MulterError) {
    if (uploadError.code === "LIMIT_FILE_SIZE") {
      return [`Maximum upload size is ${maxUploadSizeMb} MB.`];
    }

    if (uploadError.code === "LIMIT_UNEXPECTED_FILE") {
      return [`Unexpected file field "${uploadError.field}".`];
    }
  }

  return [uploadError instanceof Error ? uploadError.message : String(uploadError)];
};

chatRoutes.post("/", async (req, res) => {
  try {
    const session = getOrCreateChatSession(
      typeof req.body?.sessionId === "string" ? req.body.sessionId : undefined
    );
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    const result = await sendChatMessage({ session, message });

    res.json(result);
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

chatRoutes.post("/attachments", (req, res) => {
  upload.single("file")(req, res, (uploadError) => {
    if (uploadError) {
      res.status(400).json({
        ok: false,
        error: "Invalid chat attachment upload.",
        details: multerErrorDetails(uploadError)
      });
      return;
    }

    const file = req.file;

    if (!file) {
      res.status(400).json({
        ok: false,
        error: "Attachment file is required."
      });
      return;
    }

    const kind = uploadedFileKind(file);

    if (!kind.ok) {
      fs.promises.unlink(file.path).catch(() => undefined);
      res.status(400).json({
        ok: false,
        error: kind.error
      });
      return;
    }

    const maximumBytes =
      kind.kind === "model"
        ? unityConfig.modelUploadMaxMb * 1024 * 1024
        : unityConfig.textureUploadMaxMb * 1024 * 1024;

    if (file.size > maximumBytes) {
      fs.promises.unlink(file.path).catch(() => undefined);
      res.status(400).json({
        ok: false,
        error: `Maximum ${kind.kind} upload size is ${
          kind.kind === "model"
            ? unityConfig.modelUploadMaxMb
            : unityConfig.textureUploadMaxMb
        } MB.`
      });
      return;
    }

    const session = getOrCreateChatSession(
      typeof req.body?.sessionId === "string" ? req.body.sessionId : undefined
    );
    const attachment = addChatAttachment(session, {
      kind: kind.kind,
      extension: kind.extension,
      originalname: path.basename(file.originalname),
      path: file.path,
      size: file.size
    });

    res.json({
      ok: true,
      sessionId: session.id,
      attachment: summarizeAttachment(attachment),
      attachments: listChatAttachments(session)
    });
  });
});

chatRoutes.post("/confirmations/:key", async (req, res) => {
  try {
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : undefined;
    if (!sessionId) {
      res.status(400).json({ ok: false, error: "sessionId is required." });
      return;
    }

    const key = req.params.key;
    const action = typeof req.body?.action === "string" ? req.body.action : "";
    if (action !== "confirm" && action !== "cancel") {
      res.status(400).json({
        ok: false,
        error: "action must be 'confirm' or 'cancel'."
      });
      return;
    }

    const session = getOrCreateChatSession(sessionId);
    const result = consumePendingConfirmation(session, key);
    if (!result.ok) {
      res.status(400).json({
        ok: false,
        error:
          result.reason === "expired"
            ? "Confirmation expired (5 minute limit). Ask again to delete."
            : "Confirmation no longer available. It may have already been resolved."
      });
      return;
    }

    if (action === "cancel") {
      const note = `Cancelled "${result.confirmation.title}".`;
      addToolSummary(session, `confirmation.cancel: ${result.confirmation.kind} (${result.confirmation.targets.length} target${result.confirmation.targets.length === 1 ? "" : "s"})`);
      res.json({
        ok: true,
        sessionId: session.id,
        outcome: "cancelled",
        message: note,
        pendingConfirmations: listPendingConfirmations(session)
      });
      return;
    }

    const confirmation = result.confirmation;
    let actionResponse: UnityActionResponse | null = null;
    let actionLabel = "";
    let importedTempPath: string | undefined;

    if (confirmation.kind === "delete_object") {
      const target = confirmation.targets[0];
      if (!target) {
        res.status(400).json({ ok: false, error: "Confirmation has no target." });
        return;
      }
      actionResponse = await unityClient.deleteObject({
        instanceId: target.instanceId,
        confirm: true
      });
      actionLabel = `delete_object id=${target.instanceId}`;
    } else if (confirmation.kind === "delete_objects") {
      const instanceIds = confirmation.targets.map((t) => t.instanceId);
      actionResponse = await unityClient.deleteObjects({
        instanceIds,
        confirm: true
      });
      actionLabel = `delete_objects count=${instanceIds.length}`;
    } else if (confirmation.kind === "select_model") {
      const optionKey = typeof req.body?.optionKey === "string" ? req.body.optionKey : "";
      if (!optionKey) {
        res.status(400).json({
          ok: false,
          error: "optionKey is required for a model selection confirmation."
        });
        return;
      }
      const option = (confirmation.options ?? []).find(
        (o) => o.key === optionKey
      );
      if (!option) {
        res.status(400).json({
          ok: false,
          error: `Option "${optionKey}" was not part of this confirmation.`
        });
        return;
      }

      const meta = option.metadata as
        | {
            candidate?: OnlineModelCandidate;
            importParams?: {
              name?: string;
              position?: Vector3;
              rotation?: Vector3;
              scale?: Vector3;
            };
          }
        | undefined;
      const candidate = meta?.candidate;
      if (!candidate) {
        res.status(400).json({
          ok: false,
          error: "Confirmation option is missing candidate metadata."
        });
        return;
      }

      try {
        const downloaded = await downloadCandidateToTemp(candidate);
        importedTempPath = downloaded.absolutePath;

        const params = meta?.importParams ?? {};
        const importBody = {
          name: params.name ?? candidate.title,
          positionX: params.position?.x ?? 0,
          positionY: params.position?.y ?? 0,
          positionZ: params.position?.z ?? 0,
          rotationX: params.rotation?.x ?? 0,
          rotationY: params.rotation?.y ?? 0,
          rotationZ: params.rotation?.z ?? 0,
          scaleX: params.scale?.x ?? 1,
          scaleY: params.scale?.y ?? 1,
          scaleZ: params.scale?.z ?? 1
        };
        const validation = validateImportModelPayload(importBody, {
          originalname: downloaded.originalName,
          path: downloaded.absolutePath,
          size: downloaded.sizeBytes
        });
        if (!validation.ok) {
          actionResponse = {
            ok: false,
            error: "Could not build import payload for the picked model.",
            details: validation.details
          } satisfies UnityActionErrorResponse;
        } else {
          const payload: ImportModelPayload = validation.payload;
          actionResponse = await unityClient.importModel(payload);
        }
        actionLabel = `select_model:${candidate.source} title="${candidate.title}"`;
      } catch (error) {
        actionResponse = {
          ok: false,
          error: "Online model download or import failed.",
          details: [
            error instanceof Error ? error.message : String(error),
            `Source: ${candidate.source}, title: "${candidate.title}".`
          ]
        } satisfies UnityActionErrorResponse;
        actionLabel = `select_model:${candidate.source} (failed download)`;
      }
    } else {
      res.status(400).json({
        ok: false,
        error: `Unknown confirmation kind: ${confirmation.kind}`
      });
      return;
    }

    addToolSummary(
      session,
      `confirmation.confirm: ${actionLabel} → ${actionResponse.ok ? "ok" : "error"}${
        actionResponse.ok ? ` (${actionResponse.message})` : ` (${actionResponse.error})`
      }`
    );

    let followUp: ChatResponsePayload | null = null;
    if (actionResponse.ok) {
      const synthetic =
        `[Internal continuation note from the system, not from the user. ` +
        `The confirmation prompt "${confirmation.title}" was approved by the user and the action completed successfully: ${actionResponse.message}. ` +
        `Review your previous turn. If your original plan from the user's most recent real request had additional steps that have NOT yet been done, continue with them now ` +
        `(for example: if the user asked for a grid and you only previewed a delete, now build the grid; if the user asked to add a textured/colored model and you only previewed an online search, now apply the texture/color to the newly imported object). ` +
        `Do NOT issue any further delete_object, delete_objects, or find_online_model calls unless the user explicitly asked for more. ` +
        `If there is nothing left to do, briefly acknowledge that the action is complete and stop.]`;

      try {
        followUp = await sendChatMessage({
          session,
          message: synthetic,
          persistUser: false
        });
      } catch (error) {
        addToolSummary(
          session,
          `confirmation.followup: failed (${error instanceof Error ? error.message : String(error)})`
        );
      }
    }

    if (importedTempPath) {
      fs.promises.unlink(importedTempPath).catch(() => undefined);
    }

    res.json({
      ok: true,
      sessionId: session.id,
      outcome: actionResponse.ok ? "executed" : "failed",
      message: actionResponse.ok ? actionResponse.message : actionResponse.error,
      details:
        !actionResponse.ok && "details" in actionResponse
          ? actionResponse.details
          : undefined,
      data: actionResponse.ok ? actionResponse.data : undefined,
      pendingConfirmations: listPendingConfirmations(session),
      followUp: followUp
        ? {
            message: followUp.message,
            messages: followUp.messages,
            toolCalls: followUp.toolCalls,
            pendingConfirmations: followUp.pendingConfirmations,
            attachments: followUp.attachments,
            statusNote: followUp.statusNote
          }
        : undefined
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
