import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type {
  BackendMode,
  CreateLightPayload,
  CreateObjectPayload,
  EditTransformPayload,
  UnityDefaultObjectType,
  UnityLightType,
  UnityActionErrorResponse
} from "./types";

type BackendStatus = "checking" | "online" | "offline";

interface LogEntry {
  id: number;
  tone: "success" | "error";
  title: string;
  details?: string[];
}

const defaultCreateObjectValues = {
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

const defaultEditTransformValues = {
  target: "",
  positionX: "0",
  positionY: "0",
  positionZ: "0",
  rotationX: "0",
  rotationY: "0",
  rotationZ: "0",
  scaleX: "1",
  scaleY: "1",
  scaleZ: "1"
};

const defaultImportModelValues = {
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

const lightDefaults: Record<
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

const defaultCreateLightValues = {
  type: "directional" as UnityLightType,
  ...lightDefaults.directional
};

const objectTypeOptions: Array<{ value: UnityDefaultObjectType; label: string }> = [
  { value: "cube", label: "Cube" },
  { value: "sphere", label: "Sphere" },
  { value: "capsule", label: "Capsule" },
  { value: "cylinder", label: "Cylinder" },
  { value: "plane", label: "Plane" },
  { value: "quad", label: "Quad" }
];

const lightTypeOptions: Array<{ value: UnityLightType; label: string }> = [
  { value: "directional", label: "Directional Light" },
  { value: "point", label: "Point Light" },
  { value: "spot", label: "Spot Light" }
];

const scalePresets = ["0.01", "0.1", "1", "10", "100", "1000"];
const textureFilePattern = /\.(png|jpe?g)$/i;
const colorHexPattern = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const getDefaultCreateObjectValues = (type: UnityDefaultObjectType) => {
  const option = objectTypeOptions.find((item) => item.value === type);

  return {
    ...defaultCreateObjectValues,
    type,
    name: option?.label ?? "Object"
  };
};

const getDefaultCreateLightValues = (type: UnityLightType) => ({
  type,
  ...lightDefaults[type]
});

const formatError = (error: unknown): string[] => {
  const maybeError = error as Partial<UnityActionErrorResponse>;

  if (maybeError.details?.length) {
    return [maybeError.error ?? "Request failed", ...maybeError.details];
  }

  if (typeof maybeError.error === "string") {
    return [maybeError.error];
  }

  return ["Request failed. Check that the backend is running."];
};

const buildCreateObjectRequest = (
  values: typeof defaultCreateObjectValues
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

const buildCreateLightRequest = (
  values: typeof defaultCreateLightValues
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

const fileNameToObjectName = (fileName: string): string => {
  const withoutExtension = fileName.replace(/\.[^/.]+$/, "");
  const cleaned = withoutExtension.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned || "Model";
};

const buildImportModelFormData = (
  values: typeof defaultImportModelValues
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

const buildEditTransformRequest = (
  values: typeof defaultEditTransformValues
): EditTransformPayload | string => {
  const target = values.target.trim();
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

  if (!target) {
    return "Target object name, path, or instance ID is required.";
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

  return {
    target,
    position,
    rotation,
    scale
  };
};

export default function App() {
  const createTextureInputRef = useRef<HTMLInputElement>(null);
  const modelFileInputRef = useRef<HTMLInputElement>(null);
  const modelTextureInputRef = useRef<HTMLInputElement>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [backendMode, setBackendMode] = useState<BackendMode>("mock");
  const [isBusy, setIsBusy] = useState(false);
  const [createObjectValues, setCreateObjectValues] = useState(
    defaultCreateObjectValues
  );
  const [createLightValues, setCreateLightValues] = useState(
    defaultCreateLightValues
  );
  const [importModelValues, setImportModelValues] = useState(
    defaultImportModelValues
  );
  const [editTransformValues, setEditTransformValues] = useState(
    defaultEditTransformValues
  );
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: Date.now(),
      tone: "success",
      title: "Controller ready.",
      details: ["Backend mode is loaded from the health check."]
    }
  ]);

  const statusLabel = useMemo(() => {
    if (backendStatus === "online") {
      return `Backend online: ${backendMode.toUpperCase()}`;
    }

    if (backendStatus === "offline") {
      return "Backend offline";
    }

    return "Checking backend";
  }, [backendMode, backendStatus]);

  const isMcpMode = backendMode === "mcp";
  const modeEyebrow = isMcpMode ? "UNITY MCP MODE" : "LOCAL MOCK MODE";
  const sceneActionSubtitle = isMcpMode
    ? "Connected through Unity MCP. Default objects, lights, model imports, textures, and transform editing are enabled."
    : "Mock responses only. No Unity or MCP connection is active.";

  const addLog = (entry: Omit<LogEntry, "id">) => {
    setLogs((current) => [
      {
        ...entry,
        id: Date.now()
      },
      ...current
    ]);
  };

  const checkBackend = async () => {
    setBackendStatus("checking");

    try {
      const health = await api.health();
      if (health.mode) {
        setBackendMode(health.mode);
      }
      setBackendStatus(health.ok ? "online" : "offline");
    } catch {
      setBackendStatus("offline");
    }
  };

  useEffect(() => {
    void checkBackend();
  }, []);

  const runAction = async (
    title: string,
    action: () => Promise<{ ok: boolean; message?: string }>
  ) => {
    setIsBusy(true);

    try {
      const response = await action();
      addLog({
        tone: "success",
        title,
        details: [response.message ?? "Action completed."]
      });
    } catch (error) {
      addLog({
        tone: "error",
        title: `${title} failed`,
        details: formatError(error)
      });
    } finally {
      setIsBusy(false);
    }
  };

  const submitEditTransform = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload = buildEditTransformRequest(editTransformValues);

    if (typeof payload === "string") {
      addLog({
        tone: "error",
        title: "Apply transform failed",
        details: [payload]
      });
      return;
    }

    void runAction("Apply transform", () => api.editTransform(payload));
  };

  const submitCreateObject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload = buildCreateObjectRequest(createObjectValues);

    if (typeof payload === "string") {
      addLog({
        tone: "error",
        title: "Create object failed",
        details: [payload]
      });
      return;
    }

    void runAction("Create object", () => api.createObject(payload));
  };

  const submitCreateLight = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload = buildCreateLightRequest(createLightValues);

    if (typeof payload === "string") {
      addLog({
        tone: "error",
        title: "Create light failed",
        details: [payload]
      });
      return;
    }

    void runAction("Create light", () => api.createLight(payload));
  };

  const clearCreateTextureFile = () => {
    setCreateObjectValues((current) => ({
      ...current,
      textureFile: null
    }));

    if (createTextureInputRef.current) {
      createTextureInputRef.current.value = "";
    }
  };

  const clearModelFile = () => {
    setImportModelValues((current) => ({
      ...current,
      file: null
    }));

    if (modelFileInputRef.current) {
      modelFileInputRef.current.value = "";
    }
  };

  const clearModelTextureFile = () => {
    setImportModelValues((current) => ({
      ...current,
      textureFile: null
    }));

    if (modelTextureInputRef.current) {
      modelTextureInputRef.current.value = "";
    }
  };

  const submitImportModel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = buildImportModelFormData(importModelValues);

    if (typeof formData === "string") {
      addLog({
        tone: "error",
        title: "Add model failed",
        details: [formData]
      });
      return;
    }

    void runAction("Add model", () => api.importModel(formData));
  };

  return (
    <main className="app-shell">
      <section className="top-bar">
        <div>
          <p className="eyebrow">{modeEyebrow}</p>
          <h1>Unity MCP Controller</h1>
        </div>
        <button className={`status-pill ${backendStatus}`} onClick={checkBackend}>
          <span />
          {statusLabel}
        </button>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Scene actions</h2>
          <p>{sceneActionSubtitle}</p>
        </div>
        <div className="button-grid">
          {!isMcpMode ? (
            <button
              disabled={isBusy}
              onClick={() => void runAction("Create mock scene", api.createScene)}
            >
              Create mock scene
            </button>
          ) : null}
          <button
            disabled={isBusy}
            onClick={() =>
              void runAction(
                isMcpMode ? "Save current scene" : "Save mock scene",
                api.saveScene
              )
            }
          >
            {isMcpMode ? "Save current scene" : "Save mock scene"}
          </button>
        </div>
      </section>

      <form className="panel" onSubmit={submitCreateObject}>
        <div className="panel-heading">
          <h2>Create default object</h2>
          <p>Choose a Unity primitive, name it, and set its initial transform.</p>
        </div>
        <div className="field-stack">
          <label>
            Object type
            <select
              value={createObjectValues.type}
              onChange={(event) => {
                setCreateObjectValues(
                  getDefaultCreateObjectValues(
                    event.target.value as UnityDefaultObjectType
                  )
                );

                if (createTextureInputRef.current) {
                  createTextureInputRef.current.value = "";
                }
              }}
            >
              {objectTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Object name
            <input
              value={createObjectValues.name}
              onChange={(event) =>
                setCreateObjectValues((current) => ({
                  ...current,
                  name: event.target.value
                }))
              }
              placeholder="MyObject"
            />
          </label>
          <div className="file-field">
            <label htmlFor="create-texture-file">Texture image (optional)</label>
            <div className="file-input-row">
              <input
                accept=".png,.jpg,.jpeg"
                id="create-texture-file"
                onChange={(event) => {
                  const textureFile = event.target.files?.[0] ?? null;
                  setCreateObjectValues((current) => ({
                    ...current,
                    textureFile
                  }));
                }}
                ref={createTextureInputRef}
                type="file"
              />
              <button
                className="secondary-button file-clear-button"
                disabled={!createObjectValues.textureFile || isBusy}
                onClick={clearCreateTextureFile}
                type="button"
              >
                Clear texture
              </button>
            </div>
          </div>
          <div className="coordinate-groups">
            <fieldset>
              <legend>Position</legend>
              <div className="coordinate-row">
                {(["X", "Y", "Z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <input
                      value={createObjectValues[`position${axis}`]}
                      onChange={(event) =>
                        setCreateObjectValues((current) => ({
                          ...current,
                          [`position${axis}`]: event.target.value
                        }))
                      }
                      inputMode="decimal"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Rotation</legend>
              <div className="coordinate-row">
                {(["X", "Y", "Z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <input
                      value={createObjectValues[`rotation${axis}`]}
                      onChange={(event) =>
                        setCreateObjectValues((current) => ({
                          ...current,
                          [`rotation${axis}`]: event.target.value
                        }))
                      }
                      inputMode="decimal"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Scale</legend>
              <div className="coordinate-row">
                {(["X", "Y", "Z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <input
                      value={createObjectValues[`scale${axis}`]}
                      onChange={(event) =>
                        setCreateObjectValues((current) => ({
                          ...current,
                          [`scale${axis}`]: event.target.value
                        }))
                      }
                      inputMode="decimal"
                    />
                  </label>
                ))}
              </div>
              <div className="scale-tools">
                <label>
                  Uniform
                  <input
                    value={createObjectValues.uniformScale}
                    onChange={(event) =>
                      setCreateObjectValues((current) => ({
                        ...current,
                        uniformScale: event.target.value
                      }))
                    }
                    inputMode="decimal"
                  />
                </label>
                <button
                  disabled={isBusy}
                  onClick={() =>
                    setCreateObjectValues((current) => ({
                      ...current,
                      scaleX: current.uniformScale,
                      scaleY: current.uniformScale,
                      scaleZ: current.uniformScale
                    }))
                  }
                  type="button"
                >
                  Apply
                </button>
              </div>
              <div className="scale-presets" aria-label="Scale presets">
                {scalePresets.map((preset) => (
                  <button
                    disabled={isBusy}
                    key={preset}
                    onClick={() =>
                      setCreateObjectValues((current) => ({
                        ...current,
                        uniformScale: preset,
                        scaleX: preset,
                        scaleY: preset,
                        scaleZ: preset
                      }))
                    }
                    type="button"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
        <button disabled={isBusy} type="submit">
          Create object
        </button>
      </form>

      <form className="panel" onSubmit={submitCreateLight}>
        <div className="panel-heading">
          <h2>Create light</h2>
          <p>Create a Unity light with an initial transform, intensity, and color.</p>
        </div>
        <div className="field-stack">
          <label>
            Light type
            <select
              value={createLightValues.type}
              onChange={(event) =>
                setCreateLightValues(
                  getDefaultCreateLightValues(event.target.value as UnityLightType)
                )
              }
            >
              {lightTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Light name
            <input
              value={createLightValues.name}
              onChange={(event) =>
                setCreateLightValues((current) => ({
                  ...current,
                  name: event.target.value
                }))
              }
              placeholder="Sun"
            />
          </label>
          <div className="coordinate-groups">
            <fieldset>
              <legend>Position</legend>
              <div className="coordinate-row">
                {(["X", "Y", "Z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <input
                      value={createLightValues[`position${axis}`]}
                      onChange={(event) =>
                        setCreateLightValues((current) => ({
                          ...current,
                          [`position${axis}`]: event.target.value
                        }))
                      }
                      inputMode="decimal"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Rotation</legend>
              <div className="coordinate-row">
                {(["X", "Y", "Z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <input
                      value={createLightValues[`rotation${axis}`]}
                      onChange={(event) =>
                        setCreateLightValues((current) => ({
                          ...current,
                          [`rotation${axis}`]: event.target.value
                        }))
                      }
                      inputMode="decimal"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="coordinate-row">
            <label>
              Intensity
              <input
                value={createLightValues.intensity}
                onChange={(event) =>
                  setCreateLightValues((current) => ({
                    ...current,
                    intensity: event.target.value
                  }))
                }
                inputMode="decimal"
              />
            </label>
            <label>
              Color
              <input
                value={createLightValues.color}
                onChange={(event) =>
                  setCreateLightValues((current) => ({
                    ...current,
                    color: event.target.value
                  }))
                }
                placeholder="#ffffff"
              />
            </label>
            <label>
              Preview
              <input
                aria-label="Light color picker"
                type="color"
                value={
                  colorHexPattern.test(createLightValues.color)
                    ? createLightValues.color.slice(0, 7)
                    : "#ffffff"
                }
                onChange={(event) =>
                  setCreateLightValues((current) => ({
                    ...current,
                    color: event.target.value
                  }))
                }
              />
            </label>
          </div>
        </div>
        <button disabled={isBusy} type="submit">
          Create light
        </button>
      </form>

      <form className="panel" onSubmit={submitImportModel}>
        <div className="panel-heading">
          <h2>Import model</h2>
          <p>Upload a small FBX or OBJ model and place it in the scene.</p>
        </div>
        <div className="field-stack">
          <div className="file-field">
            <label htmlFor="model-file">Model file</label>
            <div className="file-input-row">
              <input
                accept=".fbx,.obj"
                id="model-file"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setImportModelValues((current) => ({
                    ...current,
                    file,
                    name:
                      file && (current.name.trim() === "" || current.name === "Model")
                        ? fileNameToObjectName(file.name)
                        : current.name
                  }));
                }}
                ref={modelFileInputRef}
                type="file"
              />
              <button
                className="secondary-button file-clear-button"
                disabled={!importModelValues.file || isBusy}
                onClick={clearModelFile}
                type="button"
              >
                Clear model
              </button>
            </div>
          </div>
          <div className="file-field">
            <label htmlFor="model-texture-file">Texture image (optional)</label>
            <div className="file-input-row">
              <input
                accept=".png,.jpg,.jpeg"
                id="model-texture-file"
                onChange={(event) => {
                  const textureFile = event.target.files?.[0] ?? null;
                  setImportModelValues((current) => ({
                    ...current,
                    textureFile
                  }));
                }}
                ref={modelTextureInputRef}
                type="file"
              />
              <button
                className="secondary-button file-clear-button"
                disabled={!importModelValues.textureFile || isBusy}
                onClick={clearModelTextureFile}
                type="button"
              >
                Clear texture
              </button>
            </div>
          </div>
          <label>
            Object name
            <input
              value={importModelValues.name}
              onChange={(event) =>
                setImportModelValues((current) => ({
                  ...current,
                  name: event.target.value
                }))
              }
              placeholder="TestTree"
            />
          </label>
          <div className="coordinate-groups">
            <fieldset>
              <legend>Position</legend>
              <div className="coordinate-row">
                {(["X", "Y", "Z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <input
                      value={importModelValues[`position${axis}`]}
                      onChange={(event) =>
                        setImportModelValues((current) => ({
                          ...current,
                          [`position${axis}`]: event.target.value
                        }))
                      }
                      inputMode="decimal"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Rotation</legend>
              <div className="coordinate-row">
                {(["X", "Y", "Z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <input
                      value={importModelValues[`rotation${axis}`]}
                      onChange={(event) =>
                        setImportModelValues((current) => ({
                          ...current,
                          [`rotation${axis}`]: event.target.value
                        }))
                      }
                      inputMode="decimal"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Scale</legend>
              <div className="coordinate-row">
                {(["X", "Y", "Z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <input
                      value={importModelValues[`scale${axis}`]}
                      onChange={(event) =>
                        setImportModelValues((current) => ({
                          ...current,
                          [`scale${axis}`]: event.target.value
                        }))
                      }
                      inputMode="decimal"
                    />
                  </label>
                ))}
              </div>
              <div className="scale-tools">
                <label>
                  Uniform
                  <input
                    value={importModelValues.uniformScale}
                    onChange={(event) =>
                      setImportModelValues((current) => ({
                        ...current,
                        uniformScale: event.target.value
                      }))
                    }
                    inputMode="decimal"
                  />
                </label>
                <button
                  disabled={isBusy}
                  onClick={() =>
                    setImportModelValues((current) => ({
                      ...current,
                      scaleX: current.uniformScale,
                      scaleY: current.uniformScale,
                      scaleZ: current.uniformScale
                    }))
                  }
                  type="button"
                >
                  Apply
                </button>
              </div>
              <div className="scale-presets" aria-label="Scale presets">
                {scalePresets.map((preset) => (
                  <button
                    disabled={isBusy}
                    key={preset}
                    onClick={() =>
                      setImportModelValues((current) => ({
                        ...current,
                        uniformScale: preset,
                        scaleX: preset,
                        scaleY: preset,
                        scaleZ: preset
                      }))
                    }
                    type="button"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
        <button disabled={isBusy} type="submit">
          Add model
        </button>
      </form>

      <form className="panel" onSubmit={submitEditTransform}>
        <div className="panel-heading">
          <h2>Edit existing object</h2>
          <p>Target an object by unique name, hierarchy path, or instance ID.</p>
        </div>
        <div className="field-stack">
          <label>
            Target object name, path, or instance ID
            <input
              value={editTransformValues.target}
              onChange={(event) =>
                setEditTransformValues((current) => ({
                  ...current,
                  target: event.target.value
                }))
              }
              placeholder="Cube or Parent/Child or 123456"
            />
          </label>
          <div className="coordinate-groups">
            <fieldset>
              <legend>Position</legend>
              <div className="coordinate-row">
                {(["X", "Y", "Z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <input
                      value={editTransformValues[`position${axis}`]}
                      onChange={(event) =>
                        setEditTransformValues((current) => ({
                          ...current,
                          [`position${axis}`]: event.target.value
                        }))
                      }
                      inputMode="decimal"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Rotation</legend>
              <div className="coordinate-row">
                {(["X", "Y", "Z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <input
                      value={editTransformValues[`rotation${axis}`]}
                      onChange={(event) =>
                        setEditTransformValues((current) => ({
                          ...current,
                          [`rotation${axis}`]: event.target.value
                        }))
                      }
                      inputMode="decimal"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Scale</legend>
              <div className="coordinate-row">
                {(["X", "Y", "Z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <input
                      value={editTransformValues[`scale${axis}`]}
                      onChange={(event) =>
                        setEditTransformValues((current) => ({
                          ...current,
                          [`scale${axis}`]: event.target.value
                        }))
                      }
                      inputMode="decimal"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
        <button disabled={isBusy} type="submit">
          Apply transform
        </button>
      </form>

      <section className="panel log-panel">
        <div className="panel-heading split-heading">
          <h2>Output</h2>
          <button
            className="secondary-button"
            disabled={logs.length === 0}
            onClick={() => setLogs([])}
            type="button"
          >
            Clear log
          </button>
        </div>
        <div className="log-list">
          {logs.length === 0 ? (
            <p className="empty-log">No frontend log entries.</p>
          ) : (
            logs.map((log) => (
              <article className={`log-entry ${log.tone}`} key={log.id}>
                <strong>{log.title}</strong>
                {log.details?.length ? (
                  <ul>
                    {log.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
