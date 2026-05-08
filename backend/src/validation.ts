import type { ObjectTransformPayload } from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isValidNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

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
