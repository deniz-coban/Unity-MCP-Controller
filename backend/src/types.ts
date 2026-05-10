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

export interface ColorRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type UnityDefaultObjectType =
  | "cube"
  | "sphere"
  | "capsule"
  | "cylinder"
  | "plane"
  | "quad";

export type UnityLightType = "directional" | "point" | "spot";

export type SceneObjectCategory =
  | "light"
  | "renderer"
  | "camera"
  | "generic"
  | "model"
  | "primitive";

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

export interface CreateLightPayload {
  type: UnityLightType;
  name: string;
  position: Vector3;
  rotation: Vector3;
  intensity: number;
  color: ColorRGBA;
  colorHex: string;
}

export interface MockLightData {
  lightType: UnityLightType;
  intensity: number;
  color: ColorRGBA;
  colorHex: string;
  range?: number;
  spotAngle?: number;
}

export interface SceneObjectLightDetails {
  lightType?: UnityLightType;
  color: ColorRGBA;
  colorHex: string;
  intensity: number;
  range?: number;
  spotAngle?: number;
}

export interface SceneObjectSummary {
  name: string;
  instanceId: number;
  path: string;
  sceneName?: string;
  sceneFilePath?: string;
  scenePath?: string;
  componentTypes: string[];
  hasLight: boolean;
  hasRenderer: boolean;
  hasCamera: boolean;
  category: SceneObjectCategory;
  displayName: string;
}

export interface SceneObjectDetails extends SceneObjectSummary {
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  light?: SceneObjectLightDetails;
}

export interface EditObjectPayload {
  instanceId: number;
  name?: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  light?: {
    color?: ColorRGBA;
    colorHex?: string;
    intensity?: number;
    range?: number;
    spotAngle?: number;
  };
}

export type MockObjectType = UnityDefaultObjectType | "light" | "model";

export interface MockObject {
  instanceId: number;
  name: string;
  type: MockObjectType;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  texture?: TextureMetadata;
  light?: MockLightData;
}

export interface MockSceneState {
  sceneCreated: boolean;
  objects: MockObject[];
}

export type UnityClientMode = "mock" | "mcp";

export type UnityAction =
  | "createScene"
  | "createObject"
  | "createLight"
  | "importModel"
  | "listSceneObjects"
  | "getSceneObject"
  | "editObject"
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
