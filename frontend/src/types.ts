export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

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

export type UnityLightType = "directional" | "point" | "spot";
export type SceneObjectCategory =
  | "light"
  | "renderer"
  | "camera"
  | "generic"
  | "model"
  | "primitive";

export interface CreateLightPayload {
  type: UnityLightType;
  name: string;
  position: Vector3;
  rotation: Vector3;
  intensity: number;
  color: string;
}

export interface SceneObjectLightDetails {
  lightType?: UnityLightType;
  color: Vector4Color;
  colorHex: string;
  intensity: number;
  range?: number;
  spotAngle?: number;
}

export interface Vector4Color {
  r: number;
  g: number;
  b: number;
  a: number;
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
  name: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  light?: {
    color?: string;
    intensity?: number;
    range?: number;
    spotAngle?: number;
  };
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
}

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

export type BackendMode = "mock" | "mcp";

export interface UnityActionSuccessResponse {
  ok: true;
  mode: BackendMode;
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

export interface HealthResponse {
  ok: boolean;
  service?: string;
  mode?: BackendMode;
}
