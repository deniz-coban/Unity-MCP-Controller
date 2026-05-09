import { Response, Router } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import multer from "multer";
import { unityConfig } from "../config.js";
import { unityClient } from "../unityClient.js";
import type { UnityActionResponse } from "../types.js";
import {
  validateCreateObjectPayload,
  validateImportModelPayload,
  validateTransformPayload
} from "../validation.js";

export const unityRoutes = Router();

const uploadTempDir = path.join(os.tmpdir(), "unity-mcp-controller-uploads");
const modelUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdirSync(uploadTempDir, { recursive: true });
      callback(null, uploadTempDir);
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      callback(null, `model-${suffix}${extension}`);
    }
  }),
  limits: {
    fileSize: Math.floor(unityConfig.modelUploadMaxMb * 1024 * 1024)
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

unityRoutes.post("/import-model", (req, res) => {
  modelUpload.single("model")(req, res, async (uploadError) => {
    if (uploadError) {
      const details =
        uploadError instanceof multer.MulterError &&
        uploadError.code === "LIMIT_FILE_SIZE"
          ? [`Maximum upload size is ${unityConfig.modelUploadMaxMb} MB.`]
          : [uploadError instanceof Error ? uploadError.message : String(uploadError)];

      res.status(400).json({
        ok: false,
        error: "Invalid model upload.",
        details
      });
      return;
    }

    try {
      if (!ensureSceneCreated(res)) {
        return;
      }

      const result = validateImportModelPayload(req.body, req.file);

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
      if (req.file?.path) {
        fs.promises.unlink(req.file.path).catch(() => undefined);
      }
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

unityRoutes.post("/save-scene", async (_req, res) => {
  sendUnityResponse(res, await unityClient.saveScene());
});
