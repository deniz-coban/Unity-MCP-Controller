export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface EmptyUnityActionPayload {}

export interface ObjectTransformPayload {
  objectName: string;
  coordinates: Vector3;
}

export interface EditTransformPayload {
  target: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
}

export type UnityDefaultObjectType =
  | "cube"
  | "sphere"
  | "capsule"
  | "cylinder"
  | "plane"
  | "quad";

export interface CreateObjectPayload {
  type: UnityDefaultObjectType;
  name: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  texture?: UploadedTextureFile;
}

export type ModelFileExtension = ".fbx" | ".obj";
export type TextureFileExtension = ".png" | ".jpg" | ".jpeg";

export interface UploadedModelFile {
  originalName: string;
  tempPath: string;
  sizeBytes: number;
  extension: ModelFileExtension;
}

export interface UploadedTextureFile {
  originalName: string;
  tempPath: string;
  sizeBytes: number;
  extension: TextureFileExtension;
}

export interface TextureMetadata {
  originalName: string;
  sizeBytes: number;
  extension: TextureFileExtension;
}

export interface ImportModelPayload {
  name: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  file: UploadedModelFile;
  texture?: UploadedTextureFile;
}

export type MockObjectType = UnityDefaultObjectType | "light" | "model";

export interface MockObject {
  name: string;
  type: MockObjectType;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  texture?: TextureMetadata;
}

export interface MockSceneState {
  sceneCreated: boolean;
  objects: MockObject[];
}

export type UnityClientMode = "mock" | "mcp";

export type UnityAction =
  | "createScene"
  | "createObject"
  | "importModel"
  | "addCube"
  | "addSphere"
  | "addLight"
  | "moveObject"
  | "scaleObject"
  | "editTransform"
  | "saveScene";

export interface UnityActionSuccessResponse {
  ok: true;
  mode: UnityClientMode;
  action: UnityAction;
  message: string;
  data?: unknown;
}

export interface UnityActionErrorResponse {
  ok: false;
  error: string;
  details?: string[];
}

export type UnityActionResponse =
  | UnityActionSuccessResponse
  | UnityActionErrorResponse;
