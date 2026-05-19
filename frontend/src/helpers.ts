import type {
  CreateLightPayload,
  CreateObjectPayload,
  EditObjectPayload,
  SceneObjectDetails,
  SceneObjectSummary,
  UnityActionErrorResponse,
  UnityDefaultObjectType,
  UnityLightType
} from "./types";

export type BackendStatus = "checking" | "online" | "offline";

export interface LogEntry {
  id: number;
  tone: "success" | "error";
  title: string;
  details?: string[];
}

export type ChatMessageRole = "user" | "assistant" | "system";

export interface DisplayChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  createdAt: number;
  details?: string[];
}

export const WELCOME_MESSAGE: DisplayChatMessage = {
  id: "local-welcome",
  role: "assistant",
  content:
    "Describe what you want to build in Unity. I can call safe scene tools and show each tool call here.",
  createdAt: 0
};

export const LOCAL_NOTES_LIMIT = 40;

// Keep this in sync with chatToolExecutors keys in
// backend/src/chat/toolExecutors.ts. Tools that mutate the Unity scene
// trigger a silent refresh of the manual scene-object picker.
export const SCENE_MUTATING_TOOLS = new Set<string>([
  "create_default_object",
  "create_object_grid",
  "create_light",
  "import_model",
  "move_object",
  "rotate_object",
  "scale_object",
  "rename_object",
  "edit_light",
  "batch_move_objects",
  "batch_rotate_objects",
  "batch_scale_objects",
  "delete_object",
  "delete_objects",
  "duplicate_object",
  "apply_texture_to_object",
  "set_material_color",
  "batch_apply_texture_to_objects",
  "batch_set_material_color"
]);

export const chatSessionStorageKey = "unity-mcp-controller-chat-session-id";

export const getInitialChatSessionId = (): string => {
  const existing = window.localStorage.getItem(chatSessionStorageKey);

  if (existing) {
    return existing;
  }

  const next =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(chatSessionStorageKey, next);
  return next;
};

export const defaultCreateObjectValues = {
  type: "cube" as UnityDefaultObjectType,
  name: "Cube",
  textureFile: null as File | null,
  positionX: "0",
  positionY: "0",
  positionZ: "0",
  rotationX: "0",
  rotationY: "0",
  rotationZ: "0",
  uniformScale: "1",
  scaleX: "1",
  scaleY: "1",
  scaleZ: "1"
};
export type CreateObjectValues = typeof defaultCreateObjectValues;

export const defaultEditObjectValues = {
  name: "",
  positionX: "0",
  positionY: "0",
  positionZ: "0",
  rotationX: "0",
  rotationY: "0",
  rotationZ: "0",
  scaleX: "1",
  scaleY: "1",
  scaleZ: "1",
  lightColor: "#ffffff",
  lightIntensity: "1",
  lightRange: "10",
  lightSpotAngle: "30"
};
export type EditObjectValues = typeof defaultEditObjectValues;

export const defaultImportModelValues = {
  file: null as File | null,
  name: "Model",
  textureFile: null as File | null,
  positionX: "0",
  positionY: "0",
  positionZ: "0",
  rotationX: "0",
  rotationY: "0",
  rotationZ: "0",
  uniformScale: "1",
  scaleX: "1",
  scaleY: "1",
  scaleZ: "1"
};
export type ImportModelValues = typeof defaultImportModelValues;

export const lightDefaults: Record<
  UnityLightType,
  {
    name: string;
    positionX: string;
    positionY: string;
    positionZ: string;
    rotationX: string;
    rotationY: string;
    rotationZ: string;
    intensity: string;
    color: string;
  }
> = {
  directional: {
    name: "Directional Light",
    positionX: "0",
    positionY: "3",
    positionZ: "0",
    rotationX: "50",
    rotationY: "-30",
    rotationZ: "0",
    intensity: "1",
    color: "#ffffff"
  },
  point: {
    name: "Point Light",
    positionX: "0",
    positionY: "3",
    positionZ: "0",
    rotationX: "0",
    rotationY: "0",
    rotationZ: "0",
    intensity: "1",
    color: "#ffffff"
  },
  spot: {
    name: "Spot Light",
    positionX: "0",
    positionY: "3",
    positionZ: "0",
    rotationX: "50",
    rotationY: "0",
    rotationZ: "0",
    intensity: "1",
    color: "#ffffff"
  }
};

export const defaultCreateLightValues = {
  type: "directional" as UnityLightType,
  ...lightDefaults.directional
};
export type CreateLightValues = typeof defaultCreateLightValues;

export const objectTypeOptions: Array<{
  value: UnityDefaultObjectType;
  label: string;
}> = [
  { value: "cube", label: "Cube" },
  { value: "sphere", label: "Sphere" },
  { value: "capsule", label: "Capsule" },
  { value: "cylinder", label: "Cylinder" },
  { value: "plane", label: "Plane" },
  { value: "quad", label: "Quad" }
];

export const lightTypeOptions: Array<{ value: UnityLightType; label: string }> = [
  { value: "directional", label: "Directional Light" },
  { value: "point", label: "Point Light" },
  { value: "spot", label: "Spot Light" }
];

export const scalePresets = ["0.01", "0.1", "1", "10", "100", "1000"];
export const textureFilePattern = /\.(png|jpe?g)$/i;
export const colorHexPattern = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const getDefaultCreateObjectValues = (
  type: UnityDefaultObjectType
): CreateObjectValues => {
  const option = objectTypeOptions.find((item) => item.value === type);

  return {
    ...defaultCreateObjectValues,
    type,
    name: option?.label ?? "Object"
  };
};

export const getDefaultCreateLightValues = (
  type: UnityLightType
): CreateLightValues => ({
  type,
  ...lightDefaults[type]
});

export const formatError = (error: unknown): string[] => {
  const maybeError = error as Partial<UnityActionErrorResponse>;

  if (maybeError.details?.length) {
    return [maybeError.error ?? "Request failed", ...maybeError.details];
  }

  if (typeof maybeError.error === "string") {
    return [maybeError.error];
  }

  return ["Request failed. Check that the backend is running."];
};

export const buildCreateObjectRequest = (
  values: CreateObjectValues
): CreateObjectPayload | FormData | string => {
  const name = values.name.trim();
  const position = {
    x: Number(values.positionX),
    y: Number(values.positionY),
    z: Number(values.positionZ)
  };
  const rotation = {
    x: Number(values.rotationX),
    y: Number(values.rotationY),
    z: Number(values.rotationZ)
  };
  const scale = {
    x: Number(values.scaleX),
    y: Number(values.scaleY),
    z: Number(values.scaleZ)
  };

  if (!name) {
    return "Object name is required.";
  }

  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z)
  ) {
    return "Position values must be valid numbers.";
  }

  if (
    !Number.isFinite(rotation.x) ||
    !Number.isFinite(rotation.y) ||
    !Number.isFinite(rotation.z)
  ) {
    return "Rotation values must be valid numbers.";
  }

  if (
    !Number.isFinite(scale.x) ||
    !Number.isFinite(scale.y) ||
    !Number.isFinite(scale.z)
  ) {
    return "Scale values must be valid numbers.";
  }

  if (scale.x <= 0 || scale.y <= 0 || scale.z <= 0) {
    return "Scale values must be greater than 0.";
  }

  if (values.textureFile && !textureFilePattern.test(values.textureFile.name)) {
    return "Texture file must be a .png, .jpg, or .jpeg file.";
  }

  const payload: CreateObjectPayload = {
    type: values.type,
    name,
    position,
    rotation,
    scale
  };

  if (!values.textureFile) {
    return payload;
  }

  const formData = new FormData();
  formData.append("type", payload.type);
  formData.append("name", payload.name);
  formData.append("positionX", String(position.x));
  formData.append("positionY", String(position.y));
  formData.append("positionZ", String(position.z));
  formData.append("rotationX", String(rotation.x));
  formData.append("rotationY", String(rotation.y));
  formData.append("rotationZ", String(rotation.z));
  formData.append("scaleX", String(scale.x));
  formData.append("scaleY", String(scale.y));
  formData.append("scaleZ", String(scale.z));
  formData.append("texture", values.textureFile);

  return formData;
};

export const buildCreateLightRequest = (
  values: CreateLightValues
): CreateLightPayload | string => {
  const name = values.name.trim();
  const position = {
    x: Number(values.positionX),
    y: Number(values.positionY),
    z: Number(values.positionZ)
  };
  const rotation = {
    x: Number(values.rotationX),
    y: Number(values.rotationY),
    z: Number(values.rotationZ)
  };
  const intensity = Number(values.intensity);
  const color = values.color.trim();

  if (!name) {
    return "Light name is required.";
  }

  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z)
  ) {
    return "Position values must be valid numbers.";
  }

  if (
    !Number.isFinite(rotation.x) ||
    !Number.isFinite(rotation.y) ||
    !Number.isFinite(rotation.z)
  ) {
    return "Rotation values must be valid numbers.";
  }

  if (!Number.isFinite(intensity) || intensity < 0) {
    return "Intensity must be a valid number greater than or equal to 0.";
  }

  if (!colorHexPattern.test(color)) {
    return "Color must be #RRGGBB or #RRGGBBAA.";
  }

  return {
    type: values.type,
    name,
    position,
    rotation,
    intensity,
    color
  };
};

export const fileNameToObjectName = (fileName: string): string => {
  const withoutExtension = fileName.replace(/\.[^/.]+$/, "");
  const cleaned = withoutExtension.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned || "Model";
};

export const buildImportModelFormData = (
  values: ImportModelValues
): FormData | string => {
  const name = values.name.trim();
  const position = {
    x: Number(values.positionX),
    y: Number(values.positionY),
    z: Number(values.positionZ)
  };
  const rotation = {
    x: Number(values.rotationX),
    y: Number(values.rotationY),
    z: Number(values.rotationZ)
  };
  const scale = {
    x: Number(values.scaleX),
    y: Number(values.scaleY),
    z: Number(values.scaleZ)
  };

  if (!values.file) {
    return "Model file is required.";
  }

  if (!name) {
    return "Object name is required.";
  }

  if (!/\.(fbx|obj)$/i.test(values.file.name)) {
    return "Model file must be an .fbx or .obj file.";
  }

  if (values.textureFile && !textureFilePattern.test(values.textureFile.name)) {
    return "Texture file must be a .png, .jpg, or .jpeg file.";
  }

  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z)
  ) {
    return "Position values must be valid numbers.";
  }

  if (
    !Number.isFinite(rotation.x) ||
    !Number.isFinite(rotation.y) ||
    !Number.isFinite(rotation.z)
  ) {
    return "Rotation values must be valid numbers.";
  }

  if (
    !Number.isFinite(scale.x) ||
    !Number.isFinite(scale.y) ||
    !Number.isFinite(scale.z)
  ) {
    return "Scale values must be valid numbers.";
  }

  if (scale.x <= 0 || scale.y <= 0 || scale.z <= 0) {
    return "Scale values must be greater than 0.";
  }

  const formData = new FormData();
  formData.append("model", values.file);
  formData.append("name", name);
  formData.append("positionX", String(position.x));
  formData.append("positionY", String(position.y));
  formData.append("positionZ", String(position.z));
  formData.append("rotationX", String(rotation.x));
  formData.append("rotationY", String(rotation.y));
  formData.append("rotationZ", String(rotation.z));
  formData.append("scaleX", String(scale.x));
  formData.append("scaleY", String(scale.y));
  formData.append("scaleZ", String(scale.z));
  if (values.textureFile) {
    formData.append("texture", values.textureFile);
  }

  return formData;
};

export const editValuesFromSceneObject = (
  object: SceneObjectDetails
): EditObjectValues => ({
  name: object.name,
  positionX: String(object.position.x),
  positionY: String(object.position.y),
  positionZ: String(object.position.z),
  rotationX: String(object.rotation.x),
  rotationY: String(object.rotation.y),
  rotationZ: String(object.rotation.z),
  scaleX: String(object.scale.x),
  scaleY: String(object.scale.y),
  scaleZ: String(object.scale.z),
  lightColor: object.light?.colorHex ?? "#ffffff",
  lightIntensity: String(object.light?.intensity ?? 1),
  lightRange: String(object.light?.range ?? 10),
  lightSpotAngle: String(object.light?.spotAngle ?? 30)
});

export const sceneObjectSummaryFromDetails = (
  object: SceneObjectDetails
): SceneObjectSummary => ({
  name: object.name,
  instanceId: object.instanceId,
  path: object.path,
  sceneName: object.sceneName,
  sceneFilePath: object.sceneFilePath,
  scenePath: object.scenePath,
  componentTypes: object.componentTypes,
  hasLight: object.hasLight,
  hasRenderer: object.hasRenderer,
  hasCamera: object.hasCamera,
  category: object.category,
  displayName: object.displayName
});

export const extractSceneObjects = (response: {
  data?: unknown;
}): SceneObjectSummary[] => {
  const data = response.data as { objects?: unknown } | undefined;
  return Array.isArray(data?.objects) ? (data.objects as SceneObjectSummary[]) : [];
};

export const extractSceneObject = (response: {
  data?: unknown;
}): SceneObjectDetails | undefined => {
  const data = response.data as { object?: unknown } | undefined;
  return data?.object as SceneObjectDetails | undefined;
};

export const buildEditObjectRequest = (
  selectedObject: SceneObjectDetails | null,
  values: EditObjectValues
): EditObjectPayload | string => {
  if (!selectedObject) {
    return "Select a scene object first.";
  }

  const name = values.name.trim();
  const position = {
    x: Number(values.positionX),
    y: Number(values.positionY),
    z: Number(values.positionZ)
  };
  const rotation = {
    x: Number(values.rotationX),
    y: Number(values.rotationY),
    z: Number(values.rotationZ)
  };
  const scale = {
    x: Number(values.scaleX),
    y: Number(values.scaleY),
    z: Number(values.scaleZ)
  };

  if (!name) {
    return "Object name is required.";
  }

  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z)
  ) {
    return "Position values must be valid numbers.";
  }

  if (
    !Number.isFinite(rotation.x) ||
    !Number.isFinite(rotation.y) ||
    !Number.isFinite(rotation.z)
  ) {
    return "Rotation values must be valid numbers.";
  }

  if (
    !Number.isFinite(scale.x) ||
    !Number.isFinite(scale.y) ||
    !Number.isFinite(scale.z)
  ) {
    return "Scale values must be valid numbers.";
  }

  if (scale.x <= 0 || scale.y <= 0 || scale.z <= 0) {
    return "Scale values must be greater than 0.";
  }

  const payload: EditObjectPayload = {
    instanceId: selectedObject.instanceId,
    name,
    position,
    rotation,
    scale
  };

  if (selectedObject.hasLight) {
    const intensity = Number(values.lightIntensity);
    const range = Number(values.lightRange);
    const spotAngle = Number(values.lightSpotAngle);

    if (!Number.isFinite(intensity) || intensity < 0) {
      return "Light intensity must be a valid number greater than or equal to 0.";
    }

    if (!Number.isFinite(range) || range <= 0) {
      return "Light range must be a valid number greater than 0.";
    }

    if (!colorHexPattern.test(values.lightColor.trim())) {
      return "Light color must be #RRGGBB or #RRGGBBAA.";
    }

    payload.light = {
      color: values.lightColor.trim(),
      intensity,
      range
    };

    if (selectedObject.light?.lightType === "spot") {
      if (!Number.isFinite(spotAngle) || spotAngle <= 0 || spotAngle > 179) {
        return "Spot angle must be greater than 0 and less than or equal to 179.";
      }

      payload.light.spotAngle = spotAngle;
    }
  }

  return payload;
};
