import { unityConfig } from "../config.js";
import { unityClient } from "../unityClient.js";
import type {
  ApplyTextureToObjectPayload,
  BatchApplyTextureToObjectsPayload,
  BatchSetMaterialColorPayload,
  CreateObjectPayload,
  DeleteObjectsPayload,
  DuplicateObjectPayload,
  EditObjectPayload,
  PartialTransformPayload,
  RenameObjectPayload,
  SceneObjectDetails,
  SetMaterialColorPayload,
  UnityActionResponse,
  CreateObjectGridPayload,
  UnityDefaultObjectType,
  UnityLightType,
  Vector3
} from "../types.js";
import {
  validateApplyTextureToObjectMultipartPayload,
  validateBatchApplyTextureToObjectsMultipartPayload,
  validateBatchSetMaterialColorPayload,
  validateCreateLightPayload,
  validateCreateObjectMultipartPayload,
  validateCreateObjectPayload,
  validateDeleteObjectsPayload,
  validateDuplicateObjectPayload,
  validateEditObjectPayload,
  validateFindOnlineModelPayload,
  validateImportModelPayload,
  validateSetMaterialColorPayload,
  unityDefaultObjectTypes,
  unityLightTypes
} from "../validation.js";
import { searchOnlineModels } from "../online/index.js";
import { randomUUID } from "node:crypto";
import {
  getChatAttachment,
  recordPendingConfirmation
} from "./sessionStore.js";
import type {
  PendingConfirmation,
  PendingConfirmationOption,
  PendingConfirmationTarget
} from "./types.js";
import type { ChatToolContext, ChatToolResult } from "./types.js";

type ToolExecutor = (
  args: Record<string, unknown>,
  context: ChatToolContext
) => Promise<ChatToolResult>;

const objectTypeLabels: Record<UnityDefaultObjectType, string> = {
  cube: "Cube",
  sphere: "Sphere",
  capsule: "Capsule",
  cylinder: "Cylinder",
  plane: "Plane",
  quad: "Quad"
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
};

const asPositiveInteger = (value: unknown): number | undefined => {
  const parsed = asNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : undefined;
};

const asOptionalPositiveNumber = (
  value: unknown,
  label: string,
  options: { zeroAsUndefined?: boolean } = {}
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = asNumber(value);

  if (parsed === undefined) {
    throw new Error(`${label} must be a finite number.`);
  }

  if (options.zeroAsUndefined && parsed === 0) {
    return undefined;
  }

  if (parsed <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }

  return parsed;
};

const asOptionalSpotAngle = (
  value: unknown,
  options: { zeroAsUndefined?: boolean } = {}
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = asNumber(value);

  if (parsed === undefined) {
    throw new Error("spotAngle must be a finite number.");
  }

  if (options.zeroAsUndefined && parsed === 0) {
    return undefined;
  }

  if (parsed <= 0 || parsed > 179) {
    throw new Error("spotAngle must be greater than 0 and less than or equal to 179.");
  }

  return parsed;
};

const asVector3 = (
  value: unknown,
  fallback: Vector3,
  options: { positive?: boolean } = {}
): Vector3 => {
  if (!isRecord(value)) {
    return { ...fallback };
  }

  const next = { ...fallback };

  for (const axis of ["x", "y", "z"] as const) {
    const axisValue = asNumber(value[axis]);

    if (axisValue !== undefined) {
      next[axis] = axisValue;
    }
  }

  if (options.positive && (next.x <= 0 || next.y <= 0 || next.z <= 0)) {
    throw new Error("Scale values must be greater than 0.");
  }

  return next;
};

type VectorAxis = keyof Vector3;
type VectorPatch = Partial<Record<VectorAxis, number>>;
type PartialTransformField = "position" | "rotation" | "scale";
type PartialTransformMode = "absolute" | "relative" | "multiply";

const vectorAxes = ["x", "y", "z"] as const;

const asVectorPatch = (
  value: unknown,
  label: string,
  options: { positive?: boolean } = {}
): VectorPatch => {
  if (!isRecord(value)) {
    throw new Error(`${label} must include at least one numeric axis.`);
  }

  const patch: VectorPatch = {};

  for (const axis of vectorAxes) {
    if (value[axis] === undefined) {
      continue;
    }

    const axisValue = asNumber(value[axis]);

    if (axisValue === undefined) {
      throw new Error(`${label}.${axis} must be a finite number.`);
    }

    if (options.positive && axisValue <= 0) {
      throw new Error(`${label}.${axis} must be greater than 0.`);
    }

    patch[axis] = axisValue;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error(`${label} must include at least one numeric axis.`);
  }

  return patch;
};

const parseMode = <T extends string>(
  value: unknown,
  allowedModes: readonly T[],
  fallback: T
): T => {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.toLowerCase();
  if (allowedModes.includes(normalized as T)) {
    return normalized as T;
  }

  throw new Error(`mode must be one of: ${allowedModes.join(", ")}.`);
};

const applyVectorPatch = (
  current: Vector3,
  patch: VectorPatch,
  mode: PartialTransformMode,
  options: { positive?: boolean } = {}
): Vector3 => {
  const next = { ...current };

  for (const axis of vectorAxes) {
    const value = patch[axis];
    if (value === undefined) {
      continue;
    }

    if (mode === "relative") {
      next[axis] = current[axis] + value;
    } else if (mode === "multiply") {
      next[axis] = current[axis] * value;
    } else {
      next[axis] = value;
    }
  }

  if (options.positive && (next.x <= 0 || next.y <= 0 || next.z <= 0)) {
    throw new Error("Scale values must be greater than 0.");
  }

  return next;
};

const toVectorFields = (
  prefix: string,
  vector: Vector3
): Record<string, number> => ({
  [`${prefix}X`]: vector.x,
  [`${prefix}Y`]: vector.y,
  [`${prefix}Z`]: vector.z
});

const defaultNameForType = (type: UnityDefaultObjectType): string =>
  objectTypeLabels[type] ?? "Object";

const parseObjectType = (value: unknown): UnityDefaultObjectType => {
  const type = typeof value === "string" ? value.toLowerCase() : "";

  if (unityDefaultObjectTypes.includes(type as UnityDefaultObjectType)) {
    return type as UnityDefaultObjectType;
  }

  throw new Error(`type must be one of: ${unityDefaultObjectTypes.join(", ")}.`);
};

const parseLightType = (value: unknown): UnityLightType => {
  const type = typeof value === "string" ? value.toLowerCase() : "";

  if (unityLightTypes.includes(type as UnityLightType)) {
    return type as UnityLightType;
  }

  throw new Error(`type must be one of: ${unityLightTypes.join(", ")}.`);
};

const unityResult = (response: UnityActionResponse): ChatToolResult => {
  if (!response.ok) {
    return {
      ok: false,
      message: response.error,
      data: response.details ? { details: response.details } : undefined
    };
  }

  return {
    ok: true,
    message: response.message,
    data: response.data
  };
};

const requireObjectDetails = async (
  instanceId: number
): Promise<SceneObjectDetails> => {
  const response = await unityClient.getSceneObject(instanceId);

  if (!response.ok) {
    throw new Error(response.error);
  }

  const object = (response.data as { object?: unknown } | undefined)?.object;

  if (!isRecord(object)) {
    throw new Error("Scene object details were missing from the Unity response.");
  }

  return object as unknown as SceneObjectDetails;
};

const validatedEditPayload = (
  body: Record<string, unknown>
): EditObjectPayload => {
  const result = validateEditObjectPayload(body);

  if (!result.ok) {
    throw new Error(result.details.join(" "));
  }

  return result.payload;
};

const mergeLightEditPayload = async (
  args: Record<string, unknown>,
  expectedLightType?: UnityLightType
): Promise<EditObjectPayload> => {
  const instanceId = asNumber(args.instanceId);

  if (instanceId === undefined || !Number.isInteger(instanceId)) {
    throw new Error("instanceId must be an integer from list_scene_objects.");
  }

  const object = await requireObjectDetails(instanceId);

  if (!object.hasLight) {
    throw new Error("Selected object is not a light.");
  }

  const lightType = expectedLightType ?? object.light?.lightType;

  if (args.spotAngle !== undefined && lightType !== "spot") {
    throw new Error("spotAngle can only be edited on Spot Light objects.");
  }

  if (args.range !== undefined && lightType === "directional") {
    throw new Error("range can only be edited on Point or Spot Light objects.");
  }

  const light: Record<string, unknown> = {};

  for (const key of ["color", "colorHex", "intensity", "range", "spotAngle"] as const) {
    if (args[key] !== undefined) {
      light[key] = args[key];
    }
  }

  if (Object.keys(light).length === 0) {
    throw new Error("At least one light field is required.");
  }

  return validatedEditPayload({
    instanceId,
    name: object.name,
    position: object.position,
    rotation: object.rotation,
    scale: object.scale,
    light
  });
};

const partialTransformPayload = async (
  args: Record<string, unknown>,
  field: PartialTransformField,
  allowedModes: readonly PartialTransformMode[],
  fallbackMode: PartialTransformMode
): Promise<PartialTransformPayload> => {
  const instanceId = asNumber(args.instanceId);

  if (instanceId === undefined || !Number.isInteger(instanceId)) {
    throw new Error("instanceId must be an integer from list_scene_objects.");
  }

  const object = await requireObjectDetails(instanceId);
  const mode = parseMode(args.mode, allowedModes, fallbackMode);
  const patch = asVectorPatch(args[field], field, {
    positive: field === "scale"
  });
  const value = applyVectorPatch(object[field], patch, mode, {
    positive: field === "scale"
  });

  return {
    instanceId,
    [field]: value
  };
};

const createDefaultObjectPayload = (
  args: Record<string, unknown>,
  context: ChatToolContext
): CreateObjectPayload => {
  const type = parseObjectType(args.type);
  const name =
    typeof args.name === "string" && args.name.trim().length > 0
      ? args.name.trim()
      : defaultNameForType(type);
  const position = asVector3(args.position, { x: 0, y: 0, z: 0 });
  const rotation = asVector3(args.rotation, { x: 0, y: 0, z: 0 });
  const scale = asVector3(args.scale, { x: 1, y: 1, z: 1 }, { positive: true });
  const textureAttachmentId =
    typeof args.textureAttachmentId === "string" ? args.textureAttachmentId : undefined;
  const textureAttachment = getChatAttachment(context.session, textureAttachmentId);

  if (textureAttachmentId && !textureAttachment) {
    throw new Error(`Texture attachment "${textureAttachmentId}" was not found.`);
  }

  if (textureAttachment && textureAttachment.kind !== "texture") {
    throw new Error(`Attachment "${textureAttachment.id}" is not a texture.`);
  }

  const body = {
    type,
    name,
    ...toVectorFields("position", position),
    ...toVectorFields("rotation", rotation),
    ...toVectorFields("scale", scale)
  };
  const result = textureAttachment
    ? validateCreateObjectMultipartPayload(body, textureAttachment)
    : validateCreateObjectPayload({ type, name, position, rotation, scale });

  if (!result.ok) {
    throw new Error(result.details.join(" "));
  }

  return result.payload;
};

const executeListSceneObjects: ToolExecutor = async () => {
  const result = unityResult(await unityClient.listSceneObjects());
  const objects =
    isRecord(result.data) && Array.isArray(result.data.objects)
      ? result.data.objects
      : [];

  // Compact form for the LLM. Drops heavy fields (path/scenePath/sceneName/
  // sceneFilePath/componentTypes/displayName) so the model can see every id
  // even in large scenes without hitting the per-tool-output cap.
  const compact = objects.slice(0, 1000).reduce<
    Array<{
      instanceId: number;
      name: string;
      category: string;
      hasLight: boolean;
      hasRenderer: boolean;
    }>
  >((acc, raw) => {
    if (!isRecord(raw)) return acc;
    const instanceId = asNumber(raw.instanceId);
    if (instanceId === undefined || !Number.isInteger(instanceId)) return acc;
    acc.push({
      instanceId,
      name: typeof raw.name === "string" ? raw.name : `id ${instanceId}`,
      category: typeof raw.category === "string" ? raw.category : "generic",
      hasLight: Boolean(raw.hasLight),
      hasRenderer: Boolean(raw.hasRenderer)
    });
    return acc;
  }, []);

  return {
    ...result,
    data: {
      count: objects.length,
      returned: compact.length,
      objects: compact,
      ...(objects.length > compact.length
        ? {
            truncated: true,
            truncatedAt: compact.length
          }
        : {})
    }
  };
};

const executeGetSceneObjectDetails: ToolExecutor = async (args) => {
  const instanceId = asNumber(args.instanceId);

  if (instanceId === undefined || !Number.isInteger(instanceId)) {
    return { ok: false, message: "instanceId must be an integer." };
  }

  return unityResult(await unityClient.getSceneObject(instanceId));
};

const executeCreateDefaultObject: ToolExecutor = async (args, context) => {
  const payload = createDefaultObjectPayload(args, context);
  return unityResult(await unityClient.createObject(payload));
};

const executeCreateObjectGrid: ToolExecutor = async (args, context) => {
  const type = parseObjectType(args.type);
  const rows = asPositiveInteger(args.rows);
  const columns = asPositiveInteger(args.columns);

  if (!rows || !columns) {
    return { ok: false, message: "rows and columns must be positive integers." };
  }

  const total = rows * columns;
  if (total > unityConfig.chat.maxGridObjects) {
    return {
      ok: false,
      message: `create_object_grid is limited to ${unityConfig.chat.maxGridObjects} objects. Requested ${total}.`
    };
  }

  const startPosition = asVector3(args.startPosition, { x: 0, y: 0, z: 0 });
  const rotation = asVector3(args.rotation, { x: 0, y: 0, z: 0 });
  const scale = asVector3(args.scale, { x: 1, y: 1, z: 1 }, { positive: true });
  const spacing = asNumber(args.spacing) ?? Math.max(scale.x, scale.z);
  const baseName =
    typeof args.baseName === "string" && args.baseName.trim().length > 0
      ? args.baseName.trim()
      : defaultNameForType(type);
  const payload: CreateObjectGridPayload = {
    type,
    baseName,
    rows,
    columns,
    spacing,
    startPosition,
    rotation,
    scale
  };

  return unityResult(await unityClient.createObjectGrid(payload));
};

const executeCreateLight: ToolExecutor = async (args) => {
  const type = parseLightType(args.type);
  const name =
    typeof args.name === "string" && args.name.trim().length > 0
      ? args.name.trim()
      : type === "directional"
        ? "Directional Light"
        : type === "point"
          ? "Point Light"
          : "Spot Light";
  const range =
    type === "point" || type === "spot"
      ? asOptionalPositiveNumber(args.range, "range", { zeroAsUndefined: true })
      : undefined;
  const spotAngle =
    type === "spot"
      ? asOptionalSpotAngle(args.spotAngle, { zeroAsUndefined: true })
      : undefined;
  const body = {
    type,
    name,
    position: asVector3(args.position, { x: 0, y: 3, z: 0 }),
    rotation: asVector3(
      args.rotation,
      type === "directional"
        ? { x: 50, y: -30, z: 0 }
        : type === "spot"
          ? { x: 50, y: 0, z: 0 }
          : { x: 0, y: 0, z: 0 }
    ),
    intensity: asNumber(args.intensity) ?? 1,
    color: typeof args.color === "string" ? args.color : "#ffffff",
    ...(range !== undefined ? { range } : {}),
    ...(spotAngle !== undefined ? { spotAngle } : {})
  };
  const result = validateCreateLightPayload(body);

  if (!result.ok) {
    throw new Error(result.details.join(" "));
  }

  const response = await unityClient.createLight(result.payload);
  return unityResult(response);
};

const executeRenameObject: ToolExecutor = async (args) => {
  const instanceId = asNumber(args.instanceId);
  const name = typeof args.name === "string" ? args.name.trim() : "";

  if (instanceId === undefined || !Number.isInteger(instanceId)) {
    return { ok: false, message: "instanceId must be an integer from list_scene_objects." };
  }

  if (!name) {
    return { ok: false, message: "name is required." };
  }

  const payload: RenameObjectPayload = { instanceId, name };
  return unityResult(await unityClient.renameObject(payload));
};

const executeEditLight: ToolExecutor = async (args) => {
  const payload = await mergeLightEditPayload(args);
  return unityResult(await unityClient.editObject(payload));
};

const executePartialTransform = (
  field: PartialTransformField,
  allowedModes: readonly PartialTransformMode[],
  fallbackMode: PartialTransformMode
): ToolExecutor => async (args) => {
  const payload = await partialTransformPayload(
    args,
    field,
    allowedModes,
    fallbackMode
  );
  return unityResult(await unityClient.editPartialTransform(payload));
};

const executeBatchPartialTransform = (
  field: PartialTransformField,
  allowedModes: readonly PartialTransformMode[],
  fallbackMode: PartialTransformMode
): ToolExecutor => async (args) => {
  const edits = Array.isArray(args.edits) ? args.edits : undefined;

  if (!edits) {
    return { ok: false, message: "edits must be an array." };
  }

  if (edits.length > unityConfig.chat.maxBatchEditObjects) {
    return {
      ok: false,
      message: `Batch transform edits are limited to ${unityConfig.chat.maxBatchEditObjects} objects. Requested ${edits.length}.`
    };
  }

  const mode = parseMode(args.mode, allowedModes, fallbackMode);
  let succeeded = 0;
  const failures: string[] = [];

  for (const edit of edits) {
    if (!isRecord(edit)) {
      failures.push("One edit was not an object.");
      continue;
    }

    try {
      const payload = await partialTransformPayload(
        {
          ...edit,
          mode
        },
        field,
        allowedModes,
        fallbackMode
      );
      const response = await unityClient.editPartialTransform(payload);

      if (response.ok) {
        succeeded += 1;
      } else {
        failures.push(`id ${payload.instanceId}: ${response.error}`);
      }
    } catch (error) {
      failures.push(
        `id ${String(edit.instanceId ?? "unknown")}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    ok: failures.length === 0,
    message:
      failures.length === 0
        ? `Updated ${succeeded} object ${field} values.`
        : `Updated ${succeeded}/${edits.length} object ${field} values. ${failures.length} failed.`,
    data: {
      succeeded,
      failed: failures.length,
      failures: failures.slice(0, 10)
    }
  };
};

const executeImportModel: ToolExecutor = async (args, context) => {
  const modelAttachmentId =
    typeof args.modelAttachmentId === "string" ? args.modelAttachmentId : undefined;
  const textureAttachmentId =
    typeof args.textureAttachmentId === "string" ? args.textureAttachmentId : undefined;
  const modelAttachment = getChatAttachment(context.session, modelAttachmentId);
  const textureAttachment = getChatAttachment(context.session, textureAttachmentId);

  if (!modelAttachment) {
    return { ok: false, message: "A valid modelAttachmentId is required." };
  }

  if (modelAttachment.kind !== "model") {
    return { ok: false, message: "modelAttachmentId must reference a model file." };
  }

  if (textureAttachmentId && !textureAttachment) {
    return {
      ok: false,
      message: `Texture attachment "${textureAttachmentId}" was not found.`
    };
  }

  if (textureAttachment && textureAttachment.kind !== "texture") {
    return { ok: false, message: "textureAttachmentId must reference a texture file." };
  }

  const position = asVector3(args.position, { x: 0, y: 0, z: 0 });
  const rotation = asVector3(args.rotation, { x: 0, y: 0, z: 0 });
  const scale = asVector3(args.scale, { x: 1, y: 1, z: 1 }, { positive: true });
  const result = validateImportModelPayload(
    {
      name: typeof args.name === "string" ? args.name : "Model",
      ...toVectorFields("position", position),
      ...toVectorFields("rotation", rotation),
      ...toVectorFields("scale", scale)
    },
    modelAttachment,
    textureAttachment
  );

  if (!result.ok) {
    return { ok: false, message: result.details.join(" ") };
  }

  return unityResult(await unityClient.importModel(result.payload));
};

const executeSaveScene: ToolExecutor = async () => unityResult(await unityClient.saveScene());

const TARGETS_IN_DESCRIPTION = 5;

const formatTargetPreview = (target: PendingConfirmationTarget): string =>
  `id ${target.instanceId} — ${target.name}${target.category ? ` (${target.category})` : ""}`;

const buildConfirmationDescription = (
  targets: PendingConfirmationTarget[],
  truncatedTargetCount: number
): string => {
  if (targets.length === 0) {
    return "Nothing selected.";
  }
  const lines = targets.slice(0, TARGETS_IN_DESCRIPTION).map(formatTargetPreview);
  const total = targets.length + truncatedTargetCount;
  if (total > TARGETS_IN_DESCRIPTION) {
    lines.push(`…and ${total - TARGETS_IN_DESCRIPTION} more.`);
  }
  return lines.join("\n");
};

const executeDeleteObject: ToolExecutor = async (args, context) => {
  const instanceId = asNumber(args.instanceId);
  if (instanceId === undefined || !Number.isInteger(instanceId)) {
    return { ok: false, message: "instanceId must be an integer." };
  }

  const detailsResponse = await unityClient.getSceneObject(instanceId);
  if (!detailsResponse.ok) {
    return { ok: false, message: detailsResponse.error };
  }

  const object = (detailsResponse.data as { object?: unknown } | undefined)?.object;
  if (!isRecord(object)) {
    return {
      ok: false,
      message: "Scene object details were missing from the Unity response."
    };
  }
  const details = object as unknown as SceneObjectDetails;
  const target: PendingConfirmationTarget = {
    instanceId: details.instanceId,
    name: details.name,
    category: details.category
  };

  const confirmation = recordPendingConfirmation(context.session, {
    key: randomUUID(),
    kind: "delete_object",
    title: `Delete "${details.name}"?`,
    description: buildConfirmationDescription([target], 0),
    confirmLabel: "Delete object",
    cancelLabel: "Cancel",
    targets: [target],
    truncatedTargetCount: 0
  });

  return {
    ok: true,
    message: `Prepared a confirmation prompt to delete "${details.name}" (id ${details.instanceId}). The user must click Confirm in the UI to proceed.`,
    data: {
      confirmation: serializeConfirmation(confirmation)
    }
  };
};

const MAX_BATCH_DELETE_PER_PREVIEW = 500;

const executeDeleteObjects: ToolExecutor = async (args, context) => {
  const validation = validateDeleteObjectsPayload(args);
  if (!validation.ok) {
    return { ok: false, message: validation.details.join(" ") };
  }

  const payload = validation.payload as DeleteObjectsPayload;
  if (payload.instanceIds.length > MAX_BATCH_DELETE_PER_PREVIEW) {
    return {
      ok: false,
      message: `delete_objects accepts at most ${MAX_BATCH_DELETE_PER_PREVIEW} ids per call. Requested ${payload.instanceIds.length}.`
    };
  }

  const listing = await unityClient.listSceneObjects();
  if (!listing.ok) {
    return { ok: false, message: listing.error };
  }
  const sceneObjectsRaw = (listing.data as { objects?: unknown } | undefined)?.objects;
  const sceneObjects = Array.isArray(sceneObjectsRaw)
    ? (sceneObjectsRaw as Array<{ instanceId?: number; name?: string; category?: string }>)
    : [];
  const sceneById = new Map(
    sceneObjects
      .filter(
        (o) => typeof o.instanceId === "number" && typeof o.name === "string"
      )
      .map(
        (o) => [o.instanceId as number, o] as const
      )
  );

  const targets: PendingConfirmationTarget[] = [];
  const missing: number[] = [];
  for (const id of payload.instanceIds) {
    const found = sceneById.get(id);
    if (!found) {
      missing.push(id);
      continue;
    }
    targets.push({
      instanceId: id,
      name: found.name ?? `id ${id}`,
      category: found.category ?? ""
    });
  }

  if (targets.length === 0) {
    return {
      ok: false,
      message:
        missing.length > 0
          ? `None of the requested ids exist in the current scene. Missing: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}.`
          : "No targets to delete."
    };
  }

  const title =
    targets.length === 1
      ? `Delete "${targets[0].name}"?`
      : `Delete ${targets.length} objects?`;

  const confirmLabel =
    targets.length === 1
      ? "Delete object"
      : `Delete ${targets.length} objects`;

  const confirmation = recordPendingConfirmation(context.session, {
    key: randomUUID(),
    kind: "delete_objects",
    title,
    description:
      buildConfirmationDescription(targets, 0) +
      (missing.length > 0
        ? `\n(${missing.length} requested id${missing.length === 1 ? "" : "s"} not found in scene and will be skipped.)`
        : ""),
    confirmLabel,
    cancelLabel: "Cancel",
    targets,
    truncatedTargetCount: 0
  });

  return {
    ok: true,
    message: `Prepared a confirmation prompt to delete ${targets.length} object${targets.length === 1 ? "" : "s"}. The user must click Confirm in the UI to proceed.`,
    data: {
      confirmation: serializeConfirmation(confirmation),
      ...(missing.length > 0 ? { missing } : {})
    }
  };
};

const serializeConfirmation = (confirmation: PendingConfirmation) => ({
  key: confirmation.key,
  kind: confirmation.kind,
  title: confirmation.title,
  description: confirmation.description,
  confirmLabel: confirmation.confirmLabel,
  cancelLabel: confirmation.cancelLabel,
  targetCount: confirmation.targets.length,
  targets: confirmation.targets.slice(0, 10),
  ...(confirmation.options
    ? {
        options: confirmation.options.map((o) => ({
          key: o.key,
          label: o.label,
          description: o.description,
          thumbnailUrl: o.thumbnailUrl,
          metaLabel: o.metaLabel
        }))
      }
    : {})
});

const executeDuplicateObject: ToolExecutor = async (args) => {
  const validation = validateDuplicateObjectPayload(args);
  if (!validation.ok) {
    return { ok: false, message: validation.details.join(" ") };
  }
  const payload = validation.payload as DuplicateObjectPayload;
  return unityResult(await unityClient.duplicateObject(payload));
};

const executeApplyTextureToObject: ToolExecutor = async (args, context) => {
  const instanceId = asNumber(args.instanceId);
  const textureAttachmentId =
    typeof args.textureAttachmentId === "string" ? args.textureAttachmentId : undefined;

  if (instanceId === undefined || !Number.isInteger(instanceId)) {
    return { ok: false, message: "instanceId must be an integer." };
  }

  if (!textureAttachmentId) {
    return { ok: false, message: "textureAttachmentId is required." };
  }

  const attachment = getChatAttachment(context.session, textureAttachmentId);
  if (!attachment) {
    return {
      ok: false,
      message: `Texture attachment "${textureAttachmentId}" was not found.`
    };
  }
  if (attachment.kind !== "texture") {
    return {
      ok: false,
      message: `Attachment "${attachment.id}" is not a texture.`
    };
  }

  const validation = validateApplyTextureToObjectMultipartPayload(
    { instanceId },
    attachment
  );
  if (!validation.ok) {
    return { ok: false, message: validation.details.join(" ") };
  }

  return unityResult(
    await unityClient.applyTextureToObject(
      validation.payload as ApplyTextureToObjectPayload
    )
  );
};

const executeSetMaterialColor: ToolExecutor = async (args) => {
  const validation = validateSetMaterialColorPayload(args);
  if (!validation.ok) {
    return { ok: false, message: validation.details.join(" ") };
  }
  const payload = validation.payload as SetMaterialColorPayload;
  return unityResult(await unityClient.setMaterialColor(payload));
};

const executeBatchApplyTextureToObjects: ToolExecutor = async (args, context) => {
  const rawIds = Array.isArray(args.instanceIds) ? args.instanceIds : undefined;
  const textureAttachmentId =
    typeof args.textureAttachmentId === "string"
      ? args.textureAttachmentId
      : undefined;

  if (!rawIds || rawIds.length === 0) {
    return {
      ok: false,
      message: "instanceIds must be a non-empty array of integers."
    };
  }
  if (!textureAttachmentId) {
    return { ok: false, message: "textureAttachmentId is required." };
  }

  const attachment = getChatAttachment(context.session, textureAttachmentId);
  if (!attachment) {
    return {
      ok: false,
      message: `Texture attachment "${textureAttachmentId}" was not found.`
    };
  }
  if (attachment.kind !== "texture") {
    return {
      ok: false,
      message: `Attachment "${attachment.id}" is not a texture.`
    };
  }

  const validation = validateBatchApplyTextureToObjectsMultipartPayload(
    { instanceIds: rawIds },
    attachment
  );
  if (!validation.ok) {
    return { ok: false, message: validation.details.join(" ") };
  }

  return unityResult(
    await unityClient.batchApplyTextureToObjects(
      validation.payload as BatchApplyTextureToObjectsPayload
    )
  );
};

const executeFindOnlineModel: ToolExecutor = async (args, context) => {
  const validation = validateFindOnlineModelPayload(args);
  if (!validation.ok) {
    return { ok: false, message: validation.details.join(" ") };
  }
  const payload = validation.payload;

  const result = await searchOnlineModels(payload.query, payload.sources, 6);

  if (result.configuredSources.length === 0) {
    return {
      ok: false,
      message:
        "Online model search is not configured. Set POLY_PIZZA_API_KEY and/or SKETCHFAB_API_TOKEN in backend/.env and restart the backend."
    };
  }

  if (result.candidates.length === 0) {
    const errorNote =
      result.errors.length > 0
        ? ` Errors: ${result.errors
            .map((e) => `${e.source}: ${e.message}`)
            .join("; ")}.`
        : "";
    return {
      ok: false,
      message: `No online models found for "${payload.query}".${errorNote}`
    };
  }

  const options: PendingConfirmationOption[] = result.candidates.map(
    (candidate) => ({
      key: candidate.id,
      label: candidate.title,
      description: `by ${candidate.author} — ${candidate.license}`,
      thumbnailUrl: candidate.thumbnailUrl,
      metaLabel:
        candidate.source === "poly_pizza" ? "Poly Pizza" : "Sketchfab",
      metadata: {
        candidate,
        importParams: {
          name: payload.name,
          position: payload.position,
          rotation: payload.rotation,
          scale: payload.scale
        }
      }
    })
  );

  const confirmation: PendingConfirmation = recordPendingConfirmation(
    context.session,
    {
      key: randomUUID(),
      kind: "select_model",
      title: `Pick a model for "${payload.query}"`,
      description:
        `Showing ${options.length} candidate${options.length === 1 ? "" : "s"}` +
        (result.errors.length > 0
          ? ` (${result.errors.length} source error${result.errors.length === 1 ? "" : "s"})`
          : "") +
        `. The model is downloaded and imported only when you pick one.`,
      confirmLabel: "Pick this",
      cancelLabel: "Cancel",
      targets: [],
      truncatedTargetCount: 0,
      options,
      context: {
        query: payload.query
      }
    }
  );

  return {
    ok: true,
    message: `Found ${options.length} candidate${options.length === 1 ? "" : "s"} for "${payload.query}". Awaiting user selection in the UI.`,
    data: {
      confirmation: serializeConfirmation(confirmation),
      errors: result.errors
    }
  };
};

const executeBatchSetMaterialColor: ToolExecutor = async (args) => {
  const validation = validateBatchSetMaterialColorPayload(args);
  if (!validation.ok) {
    return { ok: false, message: validation.details.join(" ") };
  }
  return unityResult(
    await unityClient.batchSetMaterialColor(
      validation.payload as BatchSetMaterialColorPayload
    )
  );
};

export const chatToolExecutors: Record<string, ToolExecutor> = {
  list_scene_objects: executeListSceneObjects,
  get_scene_object_details: executeGetSceneObjectDetails,
  create_default_object: executeCreateDefaultObject,
  create_object_grid: executeCreateObjectGrid,
  create_light: executeCreateLight,
  move_object: executePartialTransform("position", ["absolute", "relative"], "absolute"),
  rotate_object: executePartialTransform("rotation", ["absolute", "relative"], "absolute"),
  scale_object: executePartialTransform("scale", ["absolute", "multiply"], "absolute"),
  rename_object: executeRenameObject,
  edit_light: executeEditLight,
  batch_move_objects: executeBatchPartialTransform(
    "position",
    ["absolute", "relative"],
    "absolute"
  ),
  batch_rotate_objects: executeBatchPartialTransform(
    "rotation",
    ["absolute", "relative"],
    "absolute"
  ),
  batch_scale_objects: executeBatchPartialTransform(
    "scale",
    ["absolute", "multiply"],
    "absolute"
  ),
  import_model: executeImportModel,
  save_scene: executeSaveScene,
  delete_object: executeDeleteObject,
  delete_objects: executeDeleteObjects,
  duplicate_object: executeDuplicateObject,
  apply_texture_to_object: executeApplyTextureToObject,
  set_material_color: executeSetMaterialColor,
  batch_apply_texture_to_objects: executeBatchApplyTextureToObjects,
  batch_set_material_color: executeBatchSetMaterialColor,
  find_online_model: executeFindOnlineModel
};
