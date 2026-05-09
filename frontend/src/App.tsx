import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type {
  BackendMode,
  CreateObjectPayload,
  ObjectTransformPayload,
  UnityDefaultObjectType,
  UnityActionErrorResponse
} from "./types";

type BackendStatus = "checking" | "online" | "offline";

interface LogEntry {
  id: number;
  tone: "success" | "error";
  title: string;
  details?: string[];
}

const defaultTransform = {
  objectName: "",
  x: "0",
  y: "0",
  z: "0"
};

const defaultScaleTransform = {
  objectName: "",
  x: "1",
  y: "1",
  z: "1"
};

const defaultCreateObjectValues = {
  type: "cube" as UnityDefaultObjectType,
  name: "Cube",
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

const defaultImportModelValues = {
  file: null as File | null,
  name: "Model",
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

const objectTypeOptions: Array<{ value: UnityDefaultObjectType; label: string }> = [
  { value: "cube", label: "Cube" },
  { value: "sphere", label: "Sphere" },
  { value: "capsule", label: "Capsule" },
  { value: "cylinder", label: "Cylinder" },
  { value: "plane", label: "Plane" },
  { value: "quad", label: "Quad" }
];

const scalePresets = ["0.01", "0.1", "1", "10", "100", "1000"];

const getDefaultCreateObjectValues = (type: UnityDefaultObjectType) => {
  const option = objectTypeOptions.find((item) => item.value === type);

  return {
    ...defaultCreateObjectValues,
    type,
    name: option?.label ?? "Object"
  };
};

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

const parseTransform = (
  values: typeof defaultTransform,
  options: { requirePositiveCoordinates?: boolean } = {}
): ObjectTransformPayload | string => {
  const objectName = values.objectName.trim();
  const coordinates = {
    x: Number(values.x),
    y: Number(values.y),
    z: Number(values.z)
  };

  if (!objectName) {
    return "Object name is required.";
  }

  if (
    !Number.isFinite(coordinates.x) ||
    !Number.isFinite(coordinates.y) ||
    !Number.isFinite(coordinates.z)
  ) {
    return "Coordinates must be valid numbers.";
  }

  if (
    options.requirePositiveCoordinates &&
    (coordinates.x <= 0 || coordinates.y <= 0 || coordinates.z <= 0)
  ) {
    return "Scale coordinates must be greater than 0.";
  }

  return {
    objectName,
    coordinates
  };
};

const parseCreateObject = (
  values: typeof defaultCreateObjectValues
): CreateObjectPayload | string => {
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

  return {
    type: values.type,
    name,
    position,
    rotation,
    scale
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

  return formData;
};

export default function App() {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [backendMode, setBackendMode] = useState<BackendMode>("mock");
  const [isBusy, setIsBusy] = useState(false);
  const [createObjectValues, setCreateObjectValues] = useState(
    defaultCreateObjectValues
  );
  const [importModelValues, setImportModelValues] = useState(
    defaultImportModelValues
  );
  const [moveValues, setMoveValues] = useState(defaultTransform);
  const [scaleValues, setScaleValues] = useState(defaultScaleTransform);
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
    ? "Connected through Unity MCP. Default object and model creation are enabled."
    : "Mock responses only. No Unity or MCP connection is active.";
  const mcpOnlyDisabled = isBusy || isMcpMode;

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

  const submitTransform = (
    event: FormEvent<HTMLFormElement>,
    mode: "move" | "scale"
  ) => {
    event.preventDefault();

    const values = mode === "move" ? moveValues : scaleValues;
    const payload = parseTransform(values, {
      requirePositiveCoordinates: mode === "scale"
    });

    if (typeof payload === "string") {
      addLog({
        tone: "error",
        title: `${mode === "move" ? "Move" : "Scale"} object failed`,
        details: [payload]
      });
      return;
    }

    void runAction(
      mode === "move" ? "Move object" : "Scale object",
      () => (mode === "move" ? api.moveObject(payload) : api.scaleObject(payload))
    );
  };

  const submitCreateObject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload = parseCreateObject(createObjectValues);

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
          <button
            disabled={mcpOnlyDisabled}
            onClick={() => void runAction("Create scene", api.createScene)}
          >
            Create scene
          </button>
          <button disabled={isBusy} onClick={() => void runAction("Add cube", api.addCube)}>
            Add cube
          </button>
          <button
            disabled={mcpOnlyDisabled}
            onClick={() => void runAction("Add sphere", api.addSphere)}
          >
            Add sphere
          </button>
          <button
            disabled={mcpOnlyDisabled}
            onClick={() => void runAction("Add light", api.addLight)}
          >
            Add light
          </button>
          <button
            disabled={mcpOnlyDisabled}
            onClick={() => void runAction("Save scene", api.saveScene)}
          >
            Save scene
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
              onChange={(event) =>
                setCreateObjectValues(
                  getDefaultCreateObjectValues(
                    event.target.value as UnityDefaultObjectType
                  )
                )
              }
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

      <form className="panel" onSubmit={submitImportModel}>
        <div className="panel-heading">
          <h2>Import model</h2>
          <p>Upload a small FBX or OBJ model and place it in the scene.</p>
        </div>
        <div className="field-stack">
          <label>
            Model file
            <input
              accept=".fbx,.obj"
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
              type="file"
            />
          </label>
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

      <section className="forms-grid">
        <form className="panel" onSubmit={(event) => submitTransform(event, "move")}>
          <div className="panel-heading">
            <h2>Move object</h2>
          </div>
          <TransformFields values={moveValues} onChange={setMoveValues} />
          <button disabled={mcpOnlyDisabled} type="submit">
            Move object
          </button>
        </form>

        <form className="panel" onSubmit={(event) => submitTransform(event, "scale")}>
          <div className="panel-heading">
            <h2>Scale object</h2>
          </div>
          <TransformFields values={scaleValues} onChange={setScaleValues} />
          <button disabled={mcpOnlyDisabled} type="submit">
            Scale object
          </button>
        </form>
      </section>

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

interface TransformFieldsProps {
  values: typeof defaultTransform;
  onChange: (values: typeof defaultTransform) => void;
}

function TransformFields({ values, onChange }: TransformFieldsProps) {
  const updateField = (name: keyof typeof defaultTransform, value: string) => {
    onChange({
      ...values,
      [name]: value
    });
  };

  return (
    <div className="field-stack">
      <label>
        Object name
        <input
          value={values.objectName}
          onChange={(event) => updateField("objectName", event.target.value)}
          placeholder="Cube"
        />
      </label>
      <div className="coordinate-row">
        {(["x", "y", "z"] as const).map((axis) => (
          <label key={axis}>
            {axis.toUpperCase()}
            <input
              value={values[axis]}
              onChange={(event) => updateField(axis, event.target.value)}
              inputMode="decimal"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
