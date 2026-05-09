import type {
  CreateObjectPayload,
  ImportModelPayload,
  ModelFileExtension,
  ObjectTransformPayload,
  UnityDefaultObjectType,
  Vector3
} from "./types.js";
import path from "node:path";

export const unityDefaultObjectTypes = [
  "cube",
  "sphere",
  "capsule",
  "cylinder",
  "plane",
  "quad"
] as const satisfies readonly UnityDefaultObjectType[];

export const supportedModelExtensions = [
  ".fbx",
  ".obj"
] as const satisfies readonly ModelFileExtension[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const zeroVector = (): Vector3 => ({ x: 0, y: 0, z: 0 });

const isValidNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const parseFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

const isUnityDefaultObjectType = (value: unknown): value is UnityDefaultObjectType =>
  typeof value === "string" &&
  unityDefaultObjectTypes.includes(value.toLowerCase() as UnityDefaultObjectType);

const validateVector3 = (
  value: unknown,
  fieldName: string,
  options: { requirePositive?: boolean },
  details: string[]
): Vector3 | undefined => {
  if (!isRecord(value)) {
    details.push(`${fieldName} must include numeric x, y, and z values.`);
    return undefined;
  }

  const vector: Partial<Vector3> = {};

  for (const axis of ["x", "y", "z"] as const) {
    const axisValue = value[axis];

    if (!isValidNumber(axisValue)) {
      details.push(`${fieldName}.${axis} must be a finite number.`);
      continue;
    }

    if (options.requirePositive && axisValue <= 0) {
      details.push(`${fieldName}.${axis} must be greater than 0.`);
      continue;
    }

    vector[axis] = axisValue;
  }

  if (
    typeof vector.x !== "number" ||
    typeof vector.y !== "number" ||
    typeof vector.z !== "number"
  ) {
    return undefined;
  }

  return {
    x: vector.x,
    y: vector.y,
    z: vector.z
  };
};

const validateOptionalVector3 = (
  value: unknown,
  fieldName: string,
  options: { requirePositive?: boolean },
  details: string[]
): Vector3 | undefined => {
  if (value === undefined) {
    return zeroVector();
  }

  return validateVector3(value, fieldName, options, details);
};

const validateVector3Fields = (
  body: Record<string, unknown>,
  prefix: string,
  fieldName: string,
  options: { requirePositive?: boolean; defaultValue?: Vector3 },
  details: string[]
): Vector3 | undefined => {
  const vector: Partial<Vector3> = {};
  const axes = ["x", "y", "z"] as const;

  if (
    options.defaultValue &&
    axes.every((axis) => body[`${prefix}${axis.toUpperCase()}`] === undefined)
  ) {
    return {
      ...options.defaultValue
    };
  }

  for (const axis of axes) {
    const value = parseFiniteNumber(body[`${prefix}${axis.toUpperCase()}`]);

    if (value === undefined) {
      details.push(`${fieldName}.${axis} must be a finite number.`);
      continue;
    }

    if (options.requirePositive && value <= 0) {
      details.push(`${fieldName}.${axis} must be greater than 0.`);
      continue;
    }

    vector[axis] = value;
  }

  if (
    typeof vector.x !== "number" ||
    typeof vector.y !== "number" ||
    typeof vector.z !== "number"
  ) {
    return undefined;
  }

  return {
    x: vector.x,
    y: vector.y,
    z: vector.z
  };
};

export interface UploadedFileInput {
  originalname: string;
  path: string;
  size: number;
}

export const validateImportModelPayload = (
  body: unknown,
  file: UploadedFileInput | undefined
): { ok: true; payload: ImportModelPayload } | { ok: false; details: string[] } => {
  const details: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, details: ["Request body must include model metadata."] };
  }

  if (!file) {
    details.push("model file is required.");
  }

  const originalName = file ? path.basename(file.originalname) : "";
  const extension = path.extname(originalName).toLowerCase();

  if (file && !supportedModelExtensions.includes(extension as ModelFileExtension)) {
    details.push("model file extension must be .fbx or .obj.");
  }

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    details.push("name is required.");
  }

  const position = validateVector3Fields(
    body,
    "position",
    "position",
    { requirePositive: false },
    details
  );
  const scale = validateVector3Fields(
    body,
    "scale",
    "scale",
    { requirePositive: true },
    details
  );
  const rotation = validateVector3Fields(
    body,
    "rotation",
    "rotation",
    { requirePositive: false, defaultValue: zeroVector() },
    details
  );

  if (
    details.length > 0 ||
    !file ||
    !position ||
    !rotation ||
    !scale ||
    !supportedModelExtensions.includes(extension as ModelFileExtension)
  ) {
    return { ok: false, details };
  }

  return {
    ok: true,
    payload: {
      name: (body.name as string).trim(),
      position,
      rotation,
      scale,
      file: {
        originalName,
        tempPath: file.path,
        sizeBytes: file.size,
        extension: extension as ModelFileExtension
      }
    }
  };
};

export const validateCreateObjectPayload = (
  body: unknown
): { ok: true; payload: CreateObjectPayload } | { ok: false; details: string[] } => {
  const details: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, details: ["Request body must be a JSON object."] };
  }

  const type = typeof body.type === "string" ? body.type.toLowerCase() : body.type;

  if (!isUnityDefaultObjectType(type)) {
    details.push(
      `type must be one of: ${unityDefaultObjectTypes.join(", ")}.`
    );
  }

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    details.push("name is required.");
  }

  const position = validateVector3(
    body.position,
    "position",
    { requirePositive: false },
    details
  );
  const scale = validateVector3(
    body.scale,
    "scale",
    { requirePositive: true },
    details
  );
  const rotation = validateOptionalVector3(
    body.rotation,
    "rotation",
    { requirePositive: false },
    details
  );

  if (
    details.length > 0 ||
    !position ||
    !rotation ||
    !scale ||
    !isUnityDefaultObjectType(type)
  ) {
    return { ok: false, details };
  }

  return {
    ok: true,
    payload: {
      type,
      name: (body.name as string).trim(),
      position,
      rotation,
      scale
    }
  };
};

export const validateTransformPayload = (
  body: unknown,
  options: { requirePositiveCoordinates?: boolean } = {}
): { ok: true; payload: ObjectTransformPayload } | { ok: false; details: string[] } => {
  const details: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, details: ["Request body must be a JSON object."] };
  }

  if (typeof body.objectName !== "string" || body.objectName.trim().length === 0) {
    details.push("objectName is required.");
  }

  if (!isRecord(body.coordinates)) {
    details.push("coordinates must include numeric x, y, and z values.");
  } else {
    for (const axis of ["x", "y", "z"] as const) {
      if (!isValidNumber(body.coordinates[axis])) {
        details.push(`coordinates.${axis} must be a finite number.`);
      } else if (options.requirePositiveCoordinates && body.coordinates[axis] <= 0) {
        details.push(`coordinates.${axis} must be greater than 0.`);
      }
    }
  }

  if (details.length > 0) {
    return { ok: false, details };
  }

  const coordinates = body.coordinates as Record<"x" | "y" | "z", number>;

  return {
    ok: true,
    payload: {
      objectName: (body.objectName as string).trim(),
      coordinates: {
        x: coordinates.x,
        y: coordinates.y,
        z: coordinates.z
      }
    }
  };
};
