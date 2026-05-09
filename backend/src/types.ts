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
  scale: Vector3;
}

export type MockObjectType = UnityDefaultObjectType | "light";

export interface MockObject {
  name: string;
  type: MockObjectType;
  position: Vector3;
  scale: Vector3;
}

export interface MockSceneState {
  sceneCreated: boolean;
  objects: MockObject[];
}

export type UnityClientMode = "mock" | "mcp";

export type UnityAction =
  | "createScene"
  | "createObject"
  | "addCube"
  | "addSphere"
  | "addLight"
  | "moveObject"
  | "scaleObject"
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
