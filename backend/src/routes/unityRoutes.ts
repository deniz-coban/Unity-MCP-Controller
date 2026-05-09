import { Response, Router } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import multer from "multer";
import { unityConfig } from "../config.js";
import { unityClient } from "../unityClient.js";
import type { UnityActionResponse } from "../types.js";
import {
  validateCreateLightPayload,
  validateCreateObjectMultipartPayload,
  validateCreateObjectPayload,
  validateEditTransformPayload,
  validateImportModelPayload,
  validateTransformPayload
} from "../validation.js";

export const unityRoutes = Router();

const uploadTempDir = path.join(os.tmpdir(), "unity-mcp-controller-uploads");
const maxUploadSizeMb = Math.max(
  unityConfig.modelUploadMaxMb,
  unityConfig.textureUploadMaxMb
);
const modelUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdirSync(uploadTempDir, { recursive: true });
      callback(null, uploadTempDir);
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      callback(null, `${file.fieldname}-${suffix}${extension}`);
    }
  }),
  limits: {
    fileSize: Math.floor(maxUploadSizeMb * 1024 * 1024)
  }
});
const createObjectUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdirSync(uploadTempDir, { recursive: true });
      callback(null, uploadTempDir);
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      callback(null, `texture-${suffix}${extension}`);
    }
  }),
  limits: {
    fileSize: Math.floor(unityConfig.textureUploadMaxMb * 1024 * 1024)
  }
});

const sceneRequiredResponse = {
  ok: false,
  error: "Create a scene before performing this action."
} as const;

const sendUnityResponse = (res: Response, response: UnityActionResponse) => {
  if (!response.ok) {
    res.status(400).json(response);
    return;
  }

  res.json(response);
};

const ensureSceneCreated = (res: Response): boolean => {
  if (!unityClient.hasScene()) {
    res.status(400).json(sceneRequiredResponse);
    return false;
  }

  return true;
};

const multerErrorDetails = (
  uploadError: unknown,
  fallbackMaximumMb: number
): string[] => {
  if (uploadError instanceof multer.MulterError) {
    if (uploadError.code === "LIMIT_FILE_SIZE") {
      return [`Maximum upload size is ${fallbackMaximumMb} MB.`];
    }

    if (uploadError.code === "LIMIT_UNEXPECTED_FILE") {
      return [`Unexpected file field "${uploadError.field}".`];
    }
  }

  return [uploadError instanceof Error ? uploadError.message : String(uploadError)];
};

const isMulterFile = (value: unknown): value is Express.Multer.File =>
  typeof value === "object" &&
  value !== null &&
  "path" in value &&
  typeof (value as { path?: unknown }).path === "string";

const cleanupUploadedFiles = (
  files:
    | Express.Multer.File
    | Express.Multer.File[]
    | Record<string, Express.Multer.File[]>
    | undefined
) => {
  const fileList = Array.isArray(files)
    ? files
    : isMulterFile(files)
      ? [files]
      : files
        ? Object.values(files).flat()
        : [];

  for (const file of fileList) {
    fs.promises.unlink(file.path).catch(() => undefined);
  }
};

const firstFile = (
  files: Record<string, Express.Multer.File[]> | undefined,
  fieldName: string
): Express.Multer.File | undefined => files?.[fieldName]?.[0];

unityRoutes.post("/create-scene", async (_req, res) => {
  sendUnityResponse(res, await unityClient.createScene());
});

unityRoutes.post("/add-cube", async (_req, res) => {
  sendUnityResponse(res, await unityClient.addCube());
});

unityRoutes.post("/create-object", async (req, res) => {
  if (!ensureSceneCreated(res)) {
    return;
  }

  if (req.is("multipart/form-data")) {
    createObjectUpload.single("texture")(req, res, async (uploadError) => {
      if (uploadError) {
        res.status(400).json({
          ok: false,
          error: "Invalid texture upload.",
          details: multerErrorDetails(uploadError, unityConfig.textureUploadMaxMb)
        });
        return;
      }

      try {
        const result = validateCreateObjectMultipartPayload(req.body, req.file);

        if (!result.ok) {
          res.status(400).json({
            ok: false,
            error: "Invalid create object request.",
            details: result.details
          });
          return;
        }

        sendUnityResponse(res, await unityClient.createObject(result.payload));
      } finally {
        cleanupUploadedFiles(req.file);
      }
    });
    return;
  }

  const result = validateCreateObjectPayload(req.body);

  if (!result.ok) {
    res.status(400).json({
      ok: false,
      error: "Invalid create object request.",
      details: result.details
    });
    return;
  }

  sendUnityResponse(res, await unityClient.createObject(result.payload));
});

unityRoutes.post("/create-light", async (req, res) => {
  if (!ensureSceneCreated(res)) {
    return;
  }

  const result = validateCreateLightPayload(req.body);

  if (!result.ok) {
    res.status(400).json({
      ok: false,
      error: "Invalid create light request.",
      details: result.details
    });
    return;
  }

  sendUnityResponse(res, await unityClient.createLight(result.payload));
});

unityRoutes.post("/import-model", (req, res) => {
  modelUpload.fields([
    { name: "model", maxCount: 1 },
    { name: "texture", maxCount: 1 }
  ])(req, res, async (uploadError) => {
    if (uploadError) {
      res.status(400).json({
        ok: false,
        error: "Invalid model upload.",
        details: multerErrorDetails(uploadError, maxUploadSizeMb)
      });
      return;
    }

    try {
      if (!ensureSceneCreated(res)) {
        return;
      }

      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const result = validateImportModelPayload(
        req.body,
        firstFile(files, "model"),
        firstFile(files, "texture")
      );

      if (!result.ok) {
        res.status(400).json({
          ok: false,
          error: "Invalid import model request.",
          details: result.details
        });
        return;
      }

      sendUnityResponse(res, await unityClient.importModel(result.payload));
    } finally {
      cleanupUploadedFiles(
        req.files as Record<string, Express.Multer.File[]> | undefined
      );
    }
  });
});

unityRoutes.post("/add-sphere", async (_req, res) => {
  sendUnityResponse(res, await unityClient.addSphere());
});

unityRoutes.post("/add-light", async (_req, res) => {
  sendUnityResponse(res, await unityClient.addLight());
});

unityRoutes.post("/move-object", async (req, res) => {
  if (!ensureSceneCreated(res)) {
    return;
  }

  const result = validateTransformPayload(req.body);

  if (!result.ok) {
    res.status(400).json({
      ok: false,
      error: "Invalid move object request.",
      details: result.details
    });
    return;
  }

  sendUnityResponse(res, await unityClient.moveObject(result.payload));
});

unityRoutes.post("/scale-object", async (req, res) => {
  if (!ensureSceneCreated(res)) {
    return;
  }

  const result = validateTransformPayload(req.body, {
    requirePositiveCoordinates: true
  });

  if (!result.ok) {
    res.status(400).json({
      ok: false,
      error: "Invalid scale object request.",
      details: result.details
    });
    return;
  }

  sendUnityResponse(res, await unityClient.scaleObject(result.payload));
});

unityRoutes.post("/edit-transform", async (req, res) => {
  if (!ensureSceneCreated(res)) {
    return;
  }

  const result = validateEditTransformPayload(req.body);

  if (!result.ok) {
    res.status(400).json({
      ok: false,
      error: "Invalid edit transform request.",
      details: result.details
    });
    return;
  }

  sendUnityResponse(res, await unityClient.editTransform(result.payload));
});

unityRoutes.post("/save-scene", async (_req, res) => {
  sendUnityResponse(res, await unityClient.saveScene());
});
