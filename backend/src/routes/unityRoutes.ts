import { Response, Router } from "express";
import { unityClient } from "../unityClient.js";
import type { UnityActionResponse } from "../types.js";
import { validateTransformPayload } from "../validation.js";

export const unityRoutes = Router();

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
