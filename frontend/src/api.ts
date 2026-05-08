import type {
  HealthResponse,
  ObjectTransformPayload,
  UnityActionResponse
} from "./types";

const requestJson = async <T>(
  path: string,
  options: RequestInit = {}
): Promise<T> => {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });

  const body = (await response.json()) as T;

  if (!response.ok) {
    throw body;
  }

  return body;
};

export const api = {
  health(): Promise<HealthResponse> {
    return requestJson<HealthResponse>("/api/health");
  },

  createScene(): Promise<UnityActionResponse> {
    return requestJson<UnityActionResponse>("/api/unity/create-scene", {
      method: "POST"
    });
  },

  addCube(): Promise<UnityActionResponse> {
    return requestJson<UnityActionResponse>("/api/unity/add-cube", {
      method: "POST"
    });
  },

  addSphere(): Promise<UnityActionResponse> {
    return requestJson<UnityActionResponse>("/api/unity/add-sphere", {
      method: "POST"
    });
  },

  addLight(): Promise<UnityActionResponse> {
    return requestJson<UnityActionResponse>("/api/unity/add-light", {
      method: "POST"
    });
  },

  moveObject(payload: ObjectTransformPayload): Promise<UnityActionResponse> {
    return requestJson<UnityActionResponse>("/api/unity/move-object", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  scaleObject(payload: ObjectTransformPayload): Promise<UnityActionResponse> {
    return requestJson<UnityActionResponse>("/api/unity/scale-object", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  saveScene(): Promise<UnityActionResponse> {
    return requestJson<UnityActionResponse>("/api/unity/save-scene", {
      method: "POST"
    });
  }
};
