import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type {
  BackendMode,
  ObjectTransformPayload,
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

export default function App() {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [backendMode, setBackendMode] = useState<BackendMode>("mock");
  const [isBusy, setIsBusy] = useState(false);
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
    ? "Connected through Unity MCP. Currently only Add cube is enabled."
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
