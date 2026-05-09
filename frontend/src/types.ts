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
  | "importModel"
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
