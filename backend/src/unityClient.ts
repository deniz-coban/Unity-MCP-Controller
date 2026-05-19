import { unityConfig } from "./config.js";
import { mcpUnityClient } from "./mcpUnityClient.js";
import { mockUnityClient } from "./mockUnityClient.js";
import type {
  ApplyTextureToObjectPayload,
  BatchApplyTextureToObjectsPayload,
  BatchSetMaterialColorPayload,
  CreateLightPayload,
  CreateObjectGridPayload,
  CreateObjectPayload,
  DeleteObjectPayload,
  DeleteObjectsPayload,
  DuplicateObjectPayload,
  EditObjectPayload,
  EditTransformPayload,
  ImportModelPayload,
  ObjectTransformPayload,
  PartialTransformPayload,
  RenameObjectPayload,
  SetMaterialColorPayload,
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
  },

  deleteObject(payload: DeleteObjectPayload): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.deleteObject(payload)
      : mockUnityClient.deleteObject(payload);
  },

  deleteObjects(
    payload: DeleteObjectsPayload
  ): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.deleteObjects(payload)
      : mockUnityClient.deleteObjects(payload);
  },

  duplicateObject(
    payload: DuplicateObjectPayload
  ): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.duplicateObject(payload)
      : mockUnityClient.duplicateObject(payload);
  },

  applyTextureToObject(
    payload: ApplyTextureToObjectPayload
  ): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.applyTextureToObject(payload)
      : mockUnityClient.applyTextureToObject(payload);
  },

  setMaterialColor(
    payload: SetMaterialColorPayload
  ): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.setMaterialColor(payload)
      : mockUnityClient.setMaterialColor(payload);
  },

  batchApplyTextureToObjects(
    payload: BatchApplyTextureToObjectsPayload
  ): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.batchApplyTextureToObjects(payload)
      : mockUnityClient.batchApplyTextureToObjects(payload);
  },

  batchSetMaterialColor(
    payload: BatchSetMaterialColorPayload
  ): Promise<UnityActionResponse> | UnityActionResponse {
    return isMcpMode()
      ? mcpUnityClient.batchSetMaterialColor(payload)
      : mockUnityClient.batchSetMaterialColor(payload);
  }
};
