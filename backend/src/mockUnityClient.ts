import type {
  MockObject,
  MockObjectType,
  MockSceneState,
  CreateObjectPayload,
  ObjectTransformPayload,
  UnityAction,
  UnityActionErrorResponse,
  UnityActionResponse,
  UnityActionSuccessResponse
} from "./types.js";

const defaultPosition = { x: 0, y: 0, z: 0 };
const defaultScale = { x: 1, y: 1, z: 1 };
const sceneRequiredError = "Create a scene before performing this action.";

const state: MockSceneState = {
  sceneCreated: false,
  objects: []
};

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
    scale: { ...object.scale }
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
    name: nextObjectName(baseName),
    type,
    position: { ...defaultPosition },
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
    name: finalName,
    type: payload.type,
    position: { ...payload.position },
    scale: { ...payload.scale }
  };

  state.objects.push(object);

  return mockSuccess(
    action,
    `Mock ${payload.type} created as ${finalName}.`,
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
        scale: { ...defaultScale }
      },
      "addCube"
    );
  },

  createObject(payload: CreateObjectPayload): UnityActionResponse {
    return createObject(payload);
  },

  addSphere(): UnityActionResponse {
    return addObject("addSphere", "Sphere", "sphere");
  },

  addLight(): UnityActionResponse {
    return addObject("addLight", "Light", "light");
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
