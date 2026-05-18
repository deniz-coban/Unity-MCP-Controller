import { unityConfig } from "./config.js";
import { mcpUnityClient } from "./mcpUnityClient.js";
import { mockUnityClient } from "./mockUnityClient.js";
import type {
  CreateLightPayload,
  CreateObjectGridPayload,
  CreateObjectPayload,
  EditObjectPayload,
  EditTransformPayload,
  ImportModelPayload,
  ObjectTransformPayload,
  PartialTransformPayload,
  RenameObjectPayload,
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

  listSceneObjects(): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.listSceneObjects()
      : mockUnityClient.listSceneObjects();
  },

  getSceneObject(instanceId: number): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.getSceneObject(instanceId)
      : mockUnityClient.getSceneObject(instanceId);
  },

  createObject(payload: CreateObjectPayload): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.createObject(payload)
      : mockUnityClient.createObject(payload);
  },

  createObjectGrid(
    payload: CreateObjectGridPayload
  ): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.createObjectGrid(payload)
      : mockUnityClient.createObjectGrid(payload);
  },

  createLight(payload: CreateLightPayload): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.createLight(payload)
      : mockUnityClient.createLight(payload);
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

  editTransform(payload: EditTransformPayload): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.editTransform(payload)
      : mockUnityClient.editTransform(payload);
  },

  editObject(payload: EditObjectPayload): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.editObject(payload)
      : mockUnityClient.editObject(payload);
  },

  editPartialTransform(
    payload: PartialTransformPayload
  ): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.editPartialTransform(payload)
      : mockUnityClient.editPartialTransform(payload);
  },

  renameObject(payload: RenameObjectPayload): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.renameObject(payload)
      : mockUnityClient.renameObject(payload);
  },

  saveScene(): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode() ? mcpUnityClient.saveScene() : mockUnityClient.saveScene();
  }
};
