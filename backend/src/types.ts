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

export type MockObjectType = "cube" | "sphere" | "light";

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

export type UnityAction =
  | "createScene"
  | "addCube"
  | "addSphere"
  | "addLight"
  | "moveObject"
  | "scaleObject"
  | "saveScene";

export interface UnityActionSuccessResponse {
  ok: true;
  mode: "mock";
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
