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

unityRoutes.post("/create-scene", (_req, res) => {
  res.json(unityClient.createScene());
});

unityRoutes.post("/add-cube", (_req, res) => {
  sendUnityResponse(res, unityClient.addCube());
});

unityRoutes.post("/add-sphere", (_req, res) => {
  sendUnityResponse(res, unityClient.addSphere());
});

unityRoutes.post("/add-light", (_req, res) => {
  sendUnityResponse(res, unityClient.addLight());
});

unityRoutes.post("/move-object", (req, res) => {
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

  sendUnityResponse(res, unityClient.moveObject(result.payload));
});

unityRoutes.post("/scale-object", (req, res) => {
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

  sendUnityResponse(res, unityClient.scaleObject(result.payload));
});

unityRoutes.post("/save-scene", (_req, res) => {
  sendUnityResponse(res, unityClient.saveScene());
});
