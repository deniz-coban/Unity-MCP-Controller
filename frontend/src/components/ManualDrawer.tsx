import { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { api } from "../api";
import type {
  SceneObjectDetails,
  SceneObjectSummary,
  UnityDefaultObjectType,
  UnityLightType
} from "../types";
import {
  CreateLightValues,
  CreateObjectValues,
  EditObjectValues,
  ImportModelValues,
  LogEntry,
  colorHexPattern,
  fileNameToObjectName,
  getDefaultCreateLightValues,
  getDefaultCreateObjectValues,
  lightTypeOptions,
  objectTypeOptions,
  scalePresets
} from "../helpers";

interface ManualDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  isMcpMode: boolean;
  isBusy: boolean;
  sceneActionSubtitle: string;

  runAction: (
    title: string,
    action: () => Promise<{ ok: boolean; message?: string }>
  ) => Promise<void>;

  createObjectValues: CreateObjectValues;
  setCreateObjectValues: Dispatch<SetStateAction<CreateObjectValues>>;
  submitCreateObject: (event: FormEvent<HTMLFormElement>) => void;
  createTextureInputRef: RefObject<HTMLInputElement>;
  clearCreateTextureFile: () => void;

  createLightValues: CreateLightValues;
  setCreateLightValues: Dispatch<SetStateAction<CreateLightValues>>;
  submitCreateLight: (event: FormEvent<HTMLFormElement>) => void;

  importModelValues: ImportModelValues;
  setImportModelValues: Dispatch<SetStateAction<ImportModelValues>>;
  submitImportModel: (event: FormEvent<HTMLFormElement>) => void;
  modelFileInputRef: RefObject<HTMLInputElement>;
  modelTextureInputRef: RefObject<HTMLInputElement>;
  clearModelFile: () => void;
  clearModelTextureFile: () => void;

  selectedSceneObject: SceneObjectDetails | null;
  sceneObjectSearch: string;
  setSceneObjectSearch: Dispatch<SetStateAction<string>>;
  filteredSceneObjects: SceneObjectSummary[];
  refreshSceneObjects: () => Promise<void>;
  loadSceneObjectDetails: (instanceId: number) => Promise<void>;
  editObjectValues: EditObjectValues;
  setEditObjectValues: Dispatch<SetStateAction<EditObjectValues>>;
  submitEditObject: (event: FormEvent<HTMLFormElement>) => void;

  logs: LogEntry[];
  onClearLogs: () => void;
}

export function ManualDrawer({
  isOpen,
  onClose,
  isMcpMode,
  isBusy,
  sceneActionSubtitle,
  runAction,
  createObjectValues,
  setCreateObjectValues,
  submitCreateObject,
  createTextureInputRef,
  clearCreateTextureFile,
  createLightValues,
  setCreateLightValues,
  submitCreateLight,
  importModelValues,
  setImportModelValues,
  submitImportModel,
  modelFileInputRef,
  modelTextureInputRef,
  clearModelFile,
  clearModelTextureFile,
  selectedSceneObject,
  sceneObjectSearch,
  setSceneObjectSearch,
  filteredSceneObjects,
  refreshSceneObjects,
  loadSceneObjectDetails,
  editObjectValues,
  setEditObjectValues,
  submitEditObject,
  logs,
  onClearLogs
}: ManualDrawerProps) {
  return (
    <>
      <button
        aria-label="Close manual tools"
        className={`drawer-backdrop ${isOpen ? "open" : ""}`}
        onClick={onClose}
        type="button"
      />

      <aside className={`manual-drawer ${isOpen ? "open" : ""}`}>
        <div className="drawer-header">
          <div>
            <p className="eyebrow">DEBUG DASHBOARD</p>
            <h2>Manual Unity tools</h2>
          </div>
          <button className="secondary-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="drawer-scroll">

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

      <form className="panel" onSubmit={submitEditObject}>
        <div className="panel-heading split-heading">
          <div>
            <h2>Edit existing object</h2>
            <p>Refresh the active scene, search by name, path, or ID, then edit the selected instance.</p>
          </div>
          <button
            className="secondary-button"
            disabled={isBusy}
            onClick={() => void refreshSceneObjects()}
            type="button"
          >
            Refresh scene objects
          </button>
        </div>
        <div className="field-stack">
          <label>
            Search scene objects
            <input
              value={sceneObjectSearch}
              onChange={(event) => setSceneObjectSearch(event.target.value)}
              placeholder="Cube, SampleScene/Cube, or 123456"
            />
          </label>

          <div className="object-picker-list" role="listbox" aria-label="Scene objects">
            {filteredSceneObjects.length > 0 ? (
              filteredSceneObjects.map((object) => (
                <button
                  className={
                    selectedSceneObject?.instanceId === object.instanceId
                      ? "object-picker-option active"
                      : "object-picker-option"
                  }
                  disabled={isBusy}
                  key={object.instanceId}
                  onClick={() => void loadSceneObjectDetails(object.instanceId)}
                  type="button"
                >
                  <span className="object-picker-name">{object.name}</span>
                  <span>
                    {object.scenePath ?? object.path} - id {object.instanceId} - {object.category}
                  </span>
                </button>
              ))
            ) : (
              <p className="empty-log">
                No matching objects. Refresh scene objects to load the active scene.
              </p>
            )}
          </div>

          {selectedSceneObject ? (
            <>
              <div className="object-summary">
                <strong>{selectedSceneObject.name}</strong>
                <span>{selectedSceneObject.scenePath ?? selectedSceneObject.path}</span>
                {selectedSceneObject.sceneFilePath ? (
                  <span>{selectedSceneObject.sceneFilePath}</span>
                ) : null}
                <span>
                  id {selectedSceneObject.instanceId} - {selectedSceneObject.category}
                  {selectedSceneObject.componentTypes.length
                    ? ` - ${selectedSceneObject.componentTypes.join(", ")}`
                    : ""}
                </span>
              </div>

              <label>
                Object name
                <input
                  value={editObjectValues.name}
                  onChange={(event) =>
                    setEditObjectValues((current) => ({
                      ...current,
                      name: event.target.value
                    }))
                  }
                  placeholder="Object name"
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
                          value={editObjectValues[`position${axis}`]}
                          onChange={(event) =>
                            setEditObjectValues((current) => ({
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
                          value={editObjectValues[`rotation${axis}`]}
                          onChange={(event) =>
                            setEditObjectValues((current) => ({
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
                          value={editObjectValues[`scale${axis}`]}
                          onChange={(event) =>
                            setEditObjectValues((current) => ({
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

              {selectedSceneObject.hasLight ? (
                <fieldset className="light-edit-fields">
                  <legend>Light</legend>
                  <p className="field-note">
                    Type: {selectedSceneObject.light?.lightType ?? "Unknown"}
                  </p>
                  <div className="property-row">
                    <label>
                      Intensity
                      <input
                        value={editObjectValues.lightIntensity}
                        onChange={(event) =>
                          setEditObjectValues((current) => ({
                            ...current,
                            lightIntensity: event.target.value
                          }))
                        }
                        inputMode="decimal"
                      />
                    </label>
                    <label>
                      Range
                      <input
                        value={editObjectValues.lightRange}
                        onChange={(event) =>
                          setEditObjectValues((current) => ({
                            ...current,
                            lightRange: event.target.value
                          }))
                        }
                        inputMode="decimal"
                      />
                    </label>
                    {selectedSceneObject.light?.lightType === "spot" ? (
                      <label>
                        Spot angle
                        <input
                          value={editObjectValues.lightSpotAngle}
                          onChange={(event) =>
                            setEditObjectValues((current) => ({
                              ...current,
                              lightSpotAngle: event.target.value
                            }))
                          }
                          inputMode="decimal"
                        />
                      </label>
                    ) : null}
                    <label>
                      Color
                      <input
                        value={editObjectValues.lightColor}
                        onChange={(event) =>
                          setEditObjectValues((current) => ({
                            ...current,
                            lightColor: event.target.value
                          }))
                        }
                        placeholder="#ffffff"
                      />
                    </label>
                    <label>
                      Preview
                      <input
                        aria-label="Selected light color picker"
                        type="color"
                        value={
                          colorHexPattern.test(editObjectValues.lightColor)
                            ? editObjectValues.lightColor.slice(0, 7)
                            : "#ffffff"
                        }
                        onChange={(event) =>
                          setEditObjectValues((current) => ({
                            ...current,
                            lightColor: event.target.value
                          }))
                        }
                      />
                    </label>
                  </div>
                </fieldset>
              ) : null}
            </>
          ) : (
            <p className="empty-log">
              Select an object to edit its current name, transform, and supported fields.
            </p>
          )}
        </div>
        <button disabled={isBusy || !selectedSceneObject} type="submit">
          Apply changes
        </button>
      </form>

      <section className="panel log-panel">
        <div className="panel-heading split-heading">
          <h2>Output</h2>
          <button
            className="secondary-button"
            disabled={logs.length === 0}
            onClick={onClearLogs}
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
        </div>
      </aside>
    </>
  );
}
