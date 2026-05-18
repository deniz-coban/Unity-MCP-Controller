import type {
  MockObject,
  MockObjectType,
  MockSceneState,
  CreateLightPayload,
  CreateObjectGridPayload,
  CreateObjectPayload,
  EditObjectPayload,
  EditTransformPayload,
  ImportModelPayload,
  ObjectTransformPayload,
  PartialTransformPayload,
  RenameObjectPayload,
  SceneObjectCategory,
  SceneObjectDetails,
  SceneObjectSummary,
  TextureMetadata,
  UnityAction,
  UnityActionErrorResponse,
  UnityActionResponse,
  UnityActionSuccessResponse
} from "./types.js";

const defaultPosition = { x: 0, y: 0, z: 0 };
const defaultRotation = { x: 0, y: 0, z: 0 };
const defaultScale = { x: 1, y: 1, z: 1 };
const sceneRequiredError = "Create a scene before performing this action.";

const state: MockSceneState = {
  sceneCreated: false,
  objects: []
};
let nextInstanceId = 1;

const mockSuccess = (
  action: UnityAction,
  message: string,
  data?: unknown
): UnityActionSuccessResponse => ({
  ok: true,
  mode: "mock",
  action,
  message,
  ...(data ? { data } : {})
});

const mockError = (
  error: string,
  details?: string[]
): UnityActionErrorResponse => ({
  ok: false,
  error,
  ...(details?.length ? { details } : {})
});

const cloneState = (): MockSceneState => ({
  sceneCreated: state.sceneCreated,
  objects: state.objects.map((object) => ({
    ...object,
    position: { ...object.position },
    rotation: { ...object.rotation },
    scale: { ...object.scale },
    ...(object.texture ? { texture: { ...object.texture } } : {}),
    ...(object.light
      ? {
          light: {
            ...object.light,
            color: { ...object.light.color }
          }
        }
      : {})
  }))
});

const ensureScene = (): UnityActionErrorResponse | undefined => {
  if (!state.sceneCreated) {
    return mockError(sceneRequiredError);
  }

  return undefined;
};

const findObject = (name: string): MockObject | undefined =>
  state.objects.find((object) => object.name === name);

const findObjectByInstanceId = (instanceId: number): MockObject | undefined =>
  state.objects.find((object) => object.instanceId === instanceId);

const nextObjectName = (baseName: string): string => {
  if (!findObject(baseName)) {
    return baseName;
  }

  let index = 2;
  while (findObject(`${baseName}_${index}`)) {
    index += 1;
  }

  return `${baseName}_${index}`;
};

const nextObjectNameExcluding = (baseName: string, instanceId: number): string => {
  const nameExists = (name: string): boolean =>
    state.objects.some(
      (object) => object.instanceId !== instanceId && object.name === name
    );

  if (!nameExists(baseName)) {
    return baseName;
  }

  let index = 2;
  while (nameExists(`${baseName}_${index}`)) {
    index += 1;
  }

  return `${baseName}_${index}`;
};

const componentTypesForObject = (object: MockObject): string[] => {
  if (object.type === "light") {
    return ["Transform", "Light"];
  }

  if (object.type === "model") {
    return ["Transform", "MeshRenderer"];
  }

  return ["Transform", "MeshFilter", "MeshRenderer"];
};

const categoryForObject = (object: MockObject): SceneObjectCategory => {
  if (object.type === "light") {
    return "light";
  }

  if (object.type === "model") {
    return "model";
  }

  return "primitive";
};

const displayNameForObject = (object: MockObject): string =>
  `${object.name} — MockScene/${object.name} — id ${object.instanceId}`;

const sceneObjectSummary = (object: MockObject): SceneObjectSummary => {
  const componentTypes = componentTypesForObject(object);

  return {
    name: object.name,
    instanceId: object.instanceId,
    path: object.name,
    sceneName: "MockScene",
    scenePath: `MockScene/${object.name}`,
    componentTypes,
    hasLight: object.type === "light",
    hasRenderer: object.type !== "light",
    hasCamera: false,
    category: categoryForObject(object),
    displayName: displayNameForObject(object)
  };
};

const sceneObjectDetails = (object: MockObject): SceneObjectDetails => ({
  ...sceneObjectSummary(object),
  position: { ...object.position },
  rotation: { ...object.rotation },
  scale: { ...object.scale },
  ...(object.light
    ? {
        light: {
          lightType: object.light.lightType,
          color: { ...object.light.color },
          colorHex: object.light.colorHex,
          intensity: object.light.intensity,
          range: object.light.range,
          spotAngle: object.light.spotAngle
        }
      }
    : {})
});

const textureMetadata = (
  texture: CreateObjectPayload["texture"] | ImportModelPayload["texture"]
): TextureMetadata | undefined =>
  texture
    ? {
        originalName: texture.originalName,
        extension: texture.extension,
        sizeBytes: texture.sizeBytes
      }
    : undefined;

const addObject = (
  action: UnityAction,
  baseName: string,
  type: MockObjectType
): UnityActionResponse => {
  const sceneError = ensureScene();
  if (sceneError) {
    return sceneError;
  }

  const object: MockObject = {
    instanceId: nextInstanceId++,
    name: nextObjectName(baseName),
    type,
    position: { ...defaultPosition },
    rotation: { ...defaultRotation },
    scale: { ...defaultScale }
  };

  state.objects.push(object);

  return mockSuccess(action, `Mock ${baseName.toLowerCase()} added as ${object.name}.`, {
    object,
    state: cloneState()
  });
};

const createObject = (
  payload: CreateObjectPayload,
  action: UnityAction = "createObject"
): UnityActionResponse => {
  const sceneError = ensureScene();
  if (sceneError) {
    return sceneError;
  }

  const finalName = nextObjectName(payload.name);

  const object: MockObject = {
    instanceId: nextInstanceId++,
    name: finalName,
    type: payload.type,
    position: { ...payload.position },
    rotation: { ...payload.rotation },
    scale: { ...payload.scale },
    ...(payload.texture ? { texture: textureMetadata(payload.texture) } : {})
  };

  state.objects.push(object);

  return mockSuccess(
    action,
    payload.texture
      ? `Mock ${payload.type} created as ${finalName} with texture ${payload.texture.originalName}.`
      : `Mock ${payload.type} created as ${finalName}.`,
    {
      object,
      requestedName: payload.name,
      state: cloneState()
    }
  );
};

const createLight = (
  payload: CreateLightPayload,
  action: UnityAction = "createLight"
): UnityActionResponse => {
  const sceneError = ensureScene();
  if (sceneError) {
    return sceneError;
  }

  const finalName = nextObjectName(payload.name);
  const object: MockObject = {
    instanceId: nextInstanceId++,
    name: finalName,
    type: "light",
    position: { ...payload.position },
    rotation: { ...payload.rotation },
    scale: { ...defaultScale },
    light: {
      lightType: payload.type,
      intensity: payload.intensity,
      color: { ...payload.color },
      colorHex: payload.colorHex,
      range: payload.range ?? 10,
      spotAngle: payload.type === "spot" ? payload.spotAngle ?? 30 : undefined
    }
  };

  state.objects.push(object);

  return mockSuccess(
    action,
    `Mock ${payload.type} light created as ${finalName}.`,
    {
      object,
      requestedName: payload.name,
      state: cloneState()
    }
  );
};

export const mockUnityClient = {
  hasScene(): boolean {
    return state.sceneCreated;
  },

  createScene(): UnityActionSuccessResponse {
    state.sceneCreated = true;
    state.objects = [];
    nextInstanceId = 1;

    return mockSuccess("createScene", "Mock scene created successfully.", {
      state: cloneState()
    });
  },

  addCube(): UnityActionResponse {
    return createObject(
      {
        type: "cube",
        name: nextObjectName("Cube"),
        position: { ...defaultPosition },
        rotation: { ...defaultRotation },
        scale: { ...defaultScale }
      },
      "addCube"
    );
  },

  listSceneObjects(): UnityActionResponse {
    const sceneError = ensureScene();
    if (sceneError) {
      return sceneError;
    }

    const objects = state.objects.map(sceneObjectSummary);

    return mockSuccess("listSceneObjects", `Mock scene has ${objects.length} objects.`, {
      objects
    });
  },

  getSceneObject(instanceId: number): UnityActionResponse {
    const sceneError = ensureScene();
    if (sceneError) {
      return sceneError;
    }

    const object = findObjectByInstanceId(instanceId);
    if (!object) {
      return mockError("Object no longer exists. Refresh scene objects.");
    }

    return mockSuccess("getSceneObject", `Loaded mock object ${object.name}.`, {
      object: sceneObjectDetails(object)
    });
  },

  createObject(payload: CreateObjectPayload): UnityActionResponse {
    return createObject(payload);
  },

  createObjectGrid(payload: CreateObjectGridPayload): UnityActionResponse {
    const sceneError = ensureScene();
    if (sceneError) {
      return sceneError;
    }

    const total = payload.rows * payload.columns;
    const created: MockObject[] = [];

    for (let row = 0; row < payload.rows; row += 1) {
      for (let column = 0; column < payload.columns; column += 1) {
        const index = row * payload.columns + column + 1;
        const requestedName =
          total === 1 ? payload.baseName : `${payload.baseName}_${index}`;
        const finalName = nextObjectName(requestedName);
        const object: MockObject = {
          instanceId: nextInstanceId++,
          name: finalName,
          type: payload.type,
          position: {
            x: payload.startPosition.x + column * payload.spacing,
            y: payload.startPosition.y,
            z: payload.startPosition.z + row * payload.spacing
          },
          rotation: { ...payload.rotation },
          scale: { ...payload.scale }
        };

        state.objects.push(object);
        created.push(object);
      }
    }

    return mockSuccess(
      "createObjectGrid",
      `Mock ${payload.rows}x${payload.columns} ${payload.type} grid created with ${created.length} objects.`,
      {
        count: created.length,
        rows: payload.rows,
        columns: payload.columns,
        firstNames: created.slice(0, 8).map((object) => object.name),
        lastNames: created.slice(-8).map((object) => object.name),
        state: cloneState()
      }
    );
  },

  createLight(payload: CreateLightPayload): UnityActionResponse {
    return createLight(payload);
  },

  importModel(payload: ImportModelPayload): UnityActionResponse {
    const sceneError = ensureScene();
    if (sceneError) {
      return sceneError;
    }

    const finalName = nextObjectName(payload.name);
    const object: MockObject = {
      instanceId: nextInstanceId++,
      name: finalName,
      type: "model",
      position: { ...payload.position },
      rotation: { ...payload.rotation },
      scale: { ...payload.scale },
      ...(payload.texture ? { texture: textureMetadata(payload.texture) } : {})
    };

    state.objects.push(object);

    return mockSuccess(
      "importModel",
      payload.texture
        ? `Mock model imported as ${finalName} with texture ${payload.texture.originalName}.`
        : `Mock model imported as ${finalName}.`,
      {
        object,
        requestedName: payload.name,
        file: {
          originalName: payload.file.originalName,
          extension: payload.file.extension,
          sizeBytes: payload.file.sizeBytes
        },
        ...(payload.texture
          ? {
              texture: {
                originalName: payload.texture.originalName,
                extension: payload.texture.extension,
                sizeBytes: payload.texture.sizeBytes
              }
            }
          : {}),
        state: cloneState()
      }
    );
  },

  addSphere(): UnityActionResponse {
    return addObject("addSphere", "Sphere", "sphere");
  },

  addLight(): UnityActionResponse {
    return createLight(
      {
        type: "point",
        name: "Light",
        position: { ...defaultPosition },
        rotation: { ...defaultRotation },
        intensity: 1,
        color: { r: 1, g: 1, b: 1, a: 1 },
        colorHex: "#ffffff"
      },
      "addLight"
    );
  },

  moveObject(payload: ObjectTransformPayload): UnityActionResponse {
    const sceneError = ensureScene();
    if (sceneError) {
      return sceneError;
    }

    const object = findObject(payload.objectName);
    if (!object) {
      return mockError("Invalid move object request.", [
        `Object "${payload.objectName}" does not exist in the mock scene.`
      ]);
    }

    object.position = { ...payload.coordinates };

    return mockSuccess(
      "moveObject",
      `Mock moved ${payload.objectName} to (${payload.coordinates.x}, ${payload.coordinates.y}, ${payload.coordinates.z}).`,
      {
        object,
        state: cloneState()
      }
    );
  },

  scaleObject(payload: ObjectTransformPayload): UnityActionResponse {
    const sceneError = ensureScene();
    if (sceneError) {
      return sceneError;
    }

    const object = findObject(payload.objectName);
    if (!object) {
      return mockError("Invalid scale object request.", [
        `Object "${payload.objectName}" does not exist in the mock scene.`
      ]);
    }

    object.scale = { ...payload.coordinates };

    return mockSuccess(
      "scaleObject",
      `Mock scaled ${payload.objectName} to (${payload.coordinates.x}, ${payload.coordinates.y}, ${payload.coordinates.z}).`,
      {
        object,
        state: cloneState()
      }
    );
  },

  editTransform(payload: EditTransformPayload): UnityActionResponse {
    const sceneError = ensureScene();
    if (sceneError) {
      return sceneError;
    }

    const matches = state.objects.filter((object) => object.name === payload.target);

    if (matches.length === 0) {
      return mockError("Invalid edit transform request.", [
        `Object "${payload.target}" does not exist in the mock scene.`
      ]);
    }

    if (matches.length > 1) {
      return mockError("Ambiguous mock object target.", [
        `Multiple mock objects are named "${payload.target}". Use a unique object name.`
      ]);
    }

    const object = matches[0];
    object.position = { ...payload.position };
    object.rotation = { ...payload.rotation };
    object.scale = { ...payload.scale };

    return mockSuccess(
      "editTransform",
      `Mock transform updated for ${object.name}.`,
      {
        object,
        state: cloneState()
      }
    );
  },

  editObject(payload: EditObjectPayload): UnityActionResponse {
    const sceneError = ensureScene();
    if (sceneError) {
      return sceneError;
    }

    const object = findObjectByInstanceId(payload.instanceId);
    if (!object) {
      return mockError("Object no longer exists. Refresh scene objects.");
    }

    if (payload.light) {
      if (!object.light) {
        return mockError("Selected object is not a light.", [
          "Light-specific fields can only be applied to mock light objects."
        ]);
      }

      if (
        payload.light.spotAngle !== undefined &&
        object.light.lightType !== "spot"
      ) {
        return mockError("Spot angle can only be edited on Spot Light objects.");
      }
    }

    if (payload.name !== undefined) {
      object.name = nextObjectNameExcluding(payload.name, object.instanceId);
    }

    object.position = { ...payload.position };
    object.rotation = { ...payload.rotation };
    object.scale = { ...payload.scale };

    if (payload.light && object.light) {
      if (payload.light.intensity !== undefined) {
        object.light.intensity = payload.light.intensity;
      }
      if (payload.light.color && payload.light.colorHex) {
        object.light.color = { ...payload.light.color };
        object.light.colorHex = payload.light.colorHex;
      }
      if (payload.light.range !== undefined) {
        object.light.range = payload.light.range;
      }
      if (payload.light.spotAngle !== undefined) {
        object.light.spotAngle = payload.light.spotAngle;
      }
    }

    return mockSuccess("editObject", `Mock object ${object.name} updated.`, {
      object: sceneObjectDetails(object),
      state: cloneState()
    });
  },

  editPartialTransform(payload: PartialTransformPayload): UnityActionResponse {
    const sceneError = ensureScene();
    if (sceneError) {
      return sceneError;
    }

    const object = findObjectByInstanceId(payload.instanceId);
    if (!object) {
      return mockError("Object no longer exists. Refresh scene objects.");
    }

    if (payload.position) {
      object.position = { ...payload.position };
    }
    if (payload.rotation) {
      object.rotation = { ...payload.rotation };
    }
    if (payload.scale) {
      object.scale = { ...payload.scale };
    }

    return mockSuccess(
      "editPartialTransform",
      `Mock transform updated for ${object.name}.`,
      {
        object: sceneObjectDetails(object),
        state: cloneState()
      }
    );
  },

  renameObject(payload: RenameObjectPayload): UnityActionResponse {
    const sceneError = ensureScene();
    if (sceneError) {
      return sceneError;
    }

    const object = findObjectByInstanceId(payload.instanceId);
    if (!object) {
      return mockError("Object no longer exists. Refresh scene objects.");
    }

    const requestedName = payload.name.trim();
    const finalName = nextObjectNameExcluding(requestedName, payload.instanceId);
    object.name = finalName;

    return mockSuccess("renameObject", `Mock object renamed to ${finalName}.`, {
      object: sceneObjectDetails(object),
      requestedName,
      finalName,
      state: cloneState()
    });
  },

  saveScene(): UnityActionResponse {
    const sceneError = ensureScene();
    if (sceneError) {
      return sceneError;
    }

    return mockSuccess("saveScene", "Mock scene saved successfully.", {
      state: cloneState()
    });
  }
};
