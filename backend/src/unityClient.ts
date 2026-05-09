import { unityConfig } from "./config.js";
import { mcpUnityClient } from "./mcpUnityClient.js";
import { mockUnityClient } from "./mockUnityClient.js";
import type {
  CreateObjectPayload,
  ImportModelPayload,
  ObjectTransformPayload,
  UnityAction,
  UnityActionErrorResponse,
  UnityActionResponse
} from "./types.js";

const mcpUnsupported = (action: UnityAction): UnityActionErrorResponse => ({
  ok: false,
  error: "Real Unity/MCP mode does not support this action yet.",
  details: [`Unsupported action in MCP mode: ${action}`]
});

const isMcpMode = (): boolean => unityConfig.mode === "mcp";

export const unityClient = {
  hasScene(): boolean {
    return isMcpMode() || mockUnityClient.hasScene();
  },

  createScene(): UnityActionResponse {
    return isMcpMode() ? mcpUnsupported("createScene") : mockUnityClient.createScene();
  },

  addCube(): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode() ? mcpUnityClient.addCube() : mockUnityClient.addCube();
  },

  createObject(payload: CreateObjectPayload): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.createObject(payload)
      : mockUnityClient.createObject(payload);
  },

  importModel(payload: ImportModelPayload): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.importModel(payload)
      : mockUnityClient.importModel(payload);
  },

  addSphere(): UnityActionResponse {
    return isMcpMode() ? mcpUnsupported("addSphere") : mockUnityClient.addSphere();
  },

  addLight(): UnityActionResponse {
    return isMcpMode() ? mcpUnsupported("addLight") : mockUnityClient.addLight();
  },

  moveObject(payload: ObjectTransformPayload): UnityActionResponse {
    return isMcpMode() ? mcpUnsupported("moveObject") : mockUnityClient.moveObject(payload);
  },

  scaleObject(payload: ObjectTransformPayload): UnityActionResponse {
    return isMcpMode()
      ? mcpUnsupported("scaleObject")
      : mockUnityClient.scaleObject(payload);
  },

  saveScene(): UnityActionResponse {
    return isMcpMode() ? mcpUnsupported("saveScene") : mockUnityClient.saveScene();
  }
};
