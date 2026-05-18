import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { unityConfig } from "../config.js";
import { sendChatMessage } from "../chat/chatService.js";
import {
  addChatAttachment,
  getOrCreateChatSession,
  listChatAttachments,
  summarizeAttachment
} from "../chat/sessionStore.js";
import {
  supportedModelExtensions,
  supportedTextureExtensions
} from "../validation.js";
import type { ChatAttachmentKind } from "../chat/types.js";

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
