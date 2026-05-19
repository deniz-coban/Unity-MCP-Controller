import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { ActivityPanel } from "./components/ActivityPanel";
import { ChatPanel } from "./components/ChatPanel";
import { Library } from "./components/Library";
import { TopBar } from "./components/TopBar";
import {
  BackendStatus,
  DisplayChatMessage,
  LOCAL_NOTES_LIMIT,
  LogEntry,
  SCENE_MUTATING_TOOLS,
  WELCOME_MESSAGE,
  buildCreateLightRequest,
  buildCreateObjectRequest,
  buildEditObjectRequest,
  buildImportModelFormData,
  chatSessionStorageKey,
  defaultCreateLightValues,
  defaultCreateObjectValues,
  defaultEditObjectValues,
  defaultImportModelValues,
  editValuesFromSceneObject,
  extractSceneObject,
  extractSceneObjects,
  formatError,
  getInitialChatSessionId,
  sceneObjectSummaryFromDetails
} from "./helpers";
import type {
  BackendMode,
  ChatAttachment,
  ChatMessage,
  ChatToolCall,
  PendingConfirmation,
  SceneObjectDetails,
  SceneObjectSummary
} from "./types";

export default function App() {
  const createTextureInputRef = useRef<HTMLInputElement>(null);
  const modelFileInputRef = useRef<HTMLInputElement>(null);
  const modelTextureInputRef = useRef<HTMLInputElement>(null);
  const chatAttachmentInputRef = useRef<HTMLInputElement>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [backendMode, setBackendMode] = useState<BackendMode>("mock");
  const [isBusy, setIsBusy] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [isChatBusy, setIsChatBusy] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [chatSessionId, setChatSessionId] = useState(getInitialChatSessionId);
  const [chatInput, setChatInput] = useState("");
  const [serverChatMessages, setServerChatMessages] = useState<ChatMessage[]>([]);
  const [pendingUserMessage, setPendingUserMessage] =
    useState<DisplayChatMessage | null>(null);
  const [localChatNotes, setLocalChatNotes] = useState<DisplayChatMessage[]>([]);
  const [chatToolCalls, setChatToolCalls] = useState<ChatToolCall[]>([]);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [pendingConfirmations, setPendingConfirmations] = useState<
    PendingConfirmation[]
  >([]);
  const [resolvingConfirmationKey, setResolvingConfirmationKey] = useState<
    string | null
  >(null);
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [openaiConfigured, setOpenaiConfigured] = useState<boolean | undefined>(
    undefined
  );
  const [unityProjectPathConfigured, setUnityProjectPathConfigured] = useState<
    boolean | undefined
  >(undefined);
  const [polyPizzaConfigured, setPolyPizzaConfigured] = useState<
    boolean | undefined
  >(undefined);
  const [sketchfabConfigured, setSketchfabConfigured] = useState<
    boolean | undefined
  >(undefined);
  const [createObjectValues, setCreateObjectValues] = useState(
    defaultCreateObjectValues
  );
  const [createLightValues, setCreateLightValues] = useState(
    defaultCreateLightValues
  );
  const [importModelValues, setImportModelValues] = useState(
    defaultImportModelValues
  );
  const [sceneObjects, setSceneObjects] = useState<SceneObjectSummary[]>([]);
  const [sceneObjectSearch, setSceneObjectSearch] = useState("");
  const [selectedSceneObject, setSelectedSceneObject] =
    useState<SceneObjectDetails | null>(null);
  const [editObjectValues, setEditObjectValues] = useState(
    defaultEditObjectValues
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
  const filteredSceneObjects = useMemo(() => {
    const query = sceneObjectSearch.trim().toLowerCase();
    const objects = query
      ? sceneObjects.filter((object) =>
          [
            object.name,
            object.path,
            object.scenePath,
            object.displayName,
            String(object.instanceId)
          ]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(query))
        )
      : sceneObjects;

    return objects.slice(0, 12);
  }, [sceneObjectSearch, sceneObjects]);
  const recentManualLogs = useMemo(() => logs.slice(0, 5), [logs]);

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
      setOpenaiConfigured(health.openai?.configured);
      setUnityProjectPathConfigured(health.mcp?.unityProjectPathConfigured);
      setPolyPizzaConfigured(health.onlineModels?.polyPizzaConfigured);
      setSketchfabConfigured(health.onlineModels?.sketchfabConfigured);
      setHealthLoaded(true);
      setBackendStatus(health.ok ? "online" : "offline");
    } catch {
      setBackendStatus("offline");
      setHealthLoaded(true);
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

  const applySceneObjectDetails = (object: SceneObjectDetails) => {
    setSelectedSceneObject(object);
    setEditObjectValues(editValuesFromSceneObject(object));
    setSceneObjectSearch(object.displayName);
    setSceneObjects((current) => {
      const summary = sceneObjectSummaryFromDetails(object);
      const existingIndex = current.findIndex(
        (item) => item.instanceId === object.instanceId
      );

      if (existingIndex === -1) {
        return [summary, ...current];
      }

      const next = [...current];
      next[existingIndex] = summary;
      return next;
    });
  };

  const fetchAndApplySceneObjects = async (): Promise<{
    ok: true;
    message?: string;
    count: number;
  }> => {
    const response = await api.sceneObjects();
    if (!response.ok) {
      throw response;
    }

    const objects = extractSceneObjects(response);
    setSceneObjects(objects);

    if (selectedSceneObject) {
      const selectedStillExists = objects.some(
        (object) => object.instanceId === selectedSceneObject.instanceId
      );

      if (selectedStillExists) {
        const detailsResponse = await api.sceneObject(selectedSceneObject.instanceId);
        if (!detailsResponse.ok) {
          throw detailsResponse;
        }

        const object = extractSceneObject(detailsResponse);
        if (object) {
          applySceneObjectDetails(object);
        }
      } else {
        setSelectedSceneObject(null);
        setEditObjectValues(defaultEditObjectValues);
        setSceneObjectSearch("");
      }
    }

    return { ok: true, message: response.message, count: objects.length };
  };

  const refreshSceneObjects = async () => {
    setIsBusy(true);

    try {
      const result = await fetchAndApplySceneObjects();
      addLog({
        tone: "success",
        title: "Refresh scene objects",
        details: [result.message ?? `Loaded ${result.count} scene objects.`]
      });
    } catch (error) {
      addLog({
        tone: "error",
        title: "Refresh scene objects failed",
        details: formatError(error)
      });
    } finally {
      setIsBusy(false);
    }
  };

  const silentRefreshSceneObjects = async () => {
    if (isBusy) {
      return;
    }
    try {
      await fetchAndApplySceneObjects();
    } catch {
      // Swallowed by design: this is a background sync, not a user action.
    }
  };

  const loadSceneObjectDetails = async (instanceId: number) => {
    setIsBusy(true);

    try {
      const response = await api.sceneObject(instanceId);
      if (!response.ok) {
        throw response;
      }

      const object = extractSceneObject(response);

      if (!object) {
        throw { error: "Scene object details were missing from the response." };
      }

      applySceneObjectDetails(object);
      addLog({
        tone: "success",
        title: "Load scene object",
        details: [response.message ?? `Loaded ${object.displayName}.`]
      });
    } catch (error) {
      addLog({
        tone: "error",
        title: "Load scene object failed",
        details: formatError(error)
      });
    } finally {
      setIsBusy(false);
    }
  };

  const submitEditObject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload = buildEditObjectRequest(selectedSceneObject, editObjectValues);

    if (typeof payload === "string") {
      addLog({
        tone: "error",
        title: "Apply object changes failed",
        details: [payload]
      });
      return;
    }

    setIsBusy(true);

    void api
      .editObject(payload)
      .then((response) => {
        if (!response.ok) {
          throw response;
        }

        const object = extractSceneObject(response);
        if (object) {
          applySceneObjectDetails(object);
        }

        addLog({
          tone: "success",
          title: "Apply object changes",
          details: [response.message ?? "Object updated."]
        });
      })
      .catch((error) => {
        addLog({
          tone: "error",
          title: "Apply object changes failed",
          details: formatError(error)
        });
      })
      .finally(() => {
        setIsBusy(false);
      });
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

  const uploadChatAttachment = async (file: File) => {
    setIsUploadingAttachment(true);

    try {
      const response = await api.uploadChatAttachment(chatSessionId, file);
      setChatSessionId(response.sessionId);
      window.localStorage.setItem(chatSessionStorageKey, response.sessionId);
      setChatAttachments(response.attachments);
      addLog({
        tone: "success",
        title: "Chat attachment uploaded",
        details: [`${response.attachment.originalName} is available to chat as ${response.attachment.id}.`]
      });
    } catch (error) {
      addLog({
        tone: "error",
        title: "Chat attachment upload failed",
        details: formatError(error)
      });
    } finally {
      setIsUploadingAttachment(false);
      if (chatAttachmentInputRef.current) {
        chatAttachmentInputRef.current.value = "";
      }
    }
  };

  const appendLocalNotes = (notes: DisplayChatMessage[]) => {
    if (notes.length === 0) {
      return;
    }
    setLocalChatNotes((current) => {
      const next = [...current, ...notes];
      return next.length > LOCAL_NOTES_LIMIT
        ? next.slice(next.length - LOCAL_NOTES_LIMIT)
        : next;
    });
  };

  const submitChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const message = chatInput.trim();

    if (!message || isChatBusy) {
      return;
    }

    const submittedAt = Date.now();
    const optimisticUserMessage: DisplayChatMessage = {
      id: `local-pending-${submittedAt}`,
      role: "user",
      content: message,
      createdAt: submittedAt
    };

    setChatInput("");
    setPendingUserMessage(optimisticUserMessage);
    setIsChatBusy(true);

    void api
      .sendChat(chatSessionId, message)
      .then((response) => {
        setChatSessionId(response.sessionId);
        window.localStorage.setItem(chatSessionStorageKey, response.sessionId);

        if (response.messages.length > 0) {
          setServerChatMessages(response.messages);
          setPendingUserMessage(null);
        } else {
          // Server returned no canonical history — keep the optimistic
          // message visible as a local note so it doesn't vanish.
          appendLocalNotes([optimisticUserMessage]);
          setPendingUserMessage(null);
        }

        if (response.statusNote) {
          const noteTime = Date.now();
          appendLocalNotes([
            {
              id: `local-system-${noteTime}`,
              role: "system",
              content: response.statusNote.text,
              createdAt: noteTime
            }
          ]);
        }

        setChatToolCalls((current) => [...response.toolCalls, ...current].slice(0, 80));
        setChatAttachments(response.attachments);
        setPendingConfirmations(response.pendingConfirmations ?? []);

        if (response.toolCalls.length > 0) {
          addLog({
            tone: response.toolCalls.some((toolCall) => toolCall.status === "error")
              ? "error"
              : "success",
            title: "Chat tool calls completed",
            details: response.toolCalls.map(
              (toolCall) =>
                `${toolCall.toolName}: ${toolCall.status}${
                  toolCall.result || toolCall.error
                    ? ` - ${toolCall.result ?? toolCall.error}`
                    : ""
                }`
            )
          });

          const mutatedScene = response.toolCalls.some(
            (toolCall) =>
              toolCall.status === "success" &&
              SCENE_MUTATING_TOOLS.has(toolCall.toolName)
          );

          if (mutatedScene) {
            void silentRefreshSceneObjects();
          }
        }
      })
      .catch((error) => {
        const failureTime = Date.now();
        const failureDetails = formatError(error);
        appendLocalNotes([
          {
            ...optimisticUserMessage,
            id: `local-failed-user-${failureTime}`,
            createdAt: failureTime
          },
          {
            id: `local-failed-error-${failureTime}`,
            role: "assistant",
            content: failureDetails[0] ?? "Chat request failed.",
            details: failureDetails.length > 1 ? failureDetails : undefined,
            createdAt: failureTime + 1
          }
        ]);
        setPendingUserMessage(null);
        addLog({
          tone: "error",
          title: "Chat request failed",
          details: failureDetails
        });
      })
      .finally(() => {
        setIsChatBusy(false);
      });
  };

  const resolveConfirmation = async (
    confirmation: PendingConfirmation,
    action: "confirm" | "cancel",
    optionKey?: string
  ) => {
    if (resolvingConfirmationKey) {
      return;
    }
    setResolvingConfirmationKey(confirmation.key);

    try {
      const response = await api.resolveConfirmation(
        chatSessionId,
        confirmation.key,
        action,
        optionKey
      );
      setPendingConfirmations(response.pendingConfirmations ?? []);

      const time = Date.now();
      const isCancel = response.outcome === "cancelled";
      const note: DisplayChatMessage = isCancel
        ? {
            id: `local-confirm-cancel-${confirmation.key}`,
            role: "system",
            content: `Cancelled: ${confirmation.title}`,
            createdAt: time
          }
        : {
            id: `local-confirm-${response.outcome}-${confirmation.key}`,
            role: "system",
            content: response.message,
            details:
              response.details && response.details.length > 0
                ? response.details
                : undefined,
            createdAt: time
          };
      appendLocalNotes([note]);

      addLog({
        tone: response.outcome === "executed" ? "success" : "error",
        title:
          response.outcome === "executed"
            ? "Confirmation executed"
            : response.outcome === "cancelled"
              ? "Confirmation cancelled"
              : "Confirmation failed",
        details: [response.message]
      });

      if (response.outcome === "executed") {
        void silentRefreshSceneObjects();
      }

      const followUp = response.followUp;
      if (followUp) {
        if (followUp.messages.length > 0) {
          setServerChatMessages(followUp.messages);
        }
        setPendingConfirmations(followUp.pendingConfirmations ?? []);
        setChatAttachments(followUp.attachments);

        if (followUp.statusNote) {
          const noteTime = Date.now();
          appendLocalNotes([
            {
              id: `local-system-${noteTime}`,
              role: "system",
              content: followUp.statusNote.text,
              createdAt: noteTime
            }
          ]);
        }

        if (followUp.toolCalls.length > 0) {
          setChatToolCalls((current) =>
            [...followUp.toolCalls, ...current].slice(0, 80)
          );
          addLog({
            tone: followUp.toolCalls.some((tc) => tc.status === "error")
              ? "error"
              : "success",
            title: "Continuation tool calls completed",
            details: followUp.toolCalls.map(
              (tc) =>
                `${tc.toolName}: ${tc.status}${
                  tc.result || tc.error ? ` - ${tc.result ?? tc.error}` : ""
                }`
            )
          });

          const mutatedScene = followUp.toolCalls.some(
            (tc) =>
              tc.status === "success" && SCENE_MUTATING_TOOLS.has(tc.toolName)
          );
          if (mutatedScene) {
            void silentRefreshSceneObjects();
          }
        }
      }
    } catch (error) {
      const failureTime = Date.now();
      const failureDetails = formatError(error);
      appendLocalNotes([
        {
          id: `local-confirm-error-${confirmation.key}-${failureTime}`,
          role: "system",
          content: failureDetails[0] ?? "Confirmation request failed.",
          details: failureDetails.length > 1 ? failureDetails : undefined,
          createdAt: failureTime
        }
      ]);
      addLog({
        tone: "error",
        title: "Confirmation request failed",
        details: failureDetails
      });
    } finally {
      setResolvingConfirmationKey(null);
    }
  };

  const renderedChatMessages = useMemo<DisplayChatMessage[]>(() => {
    const merged: DisplayChatMessage[] = [];

    for (const m of serverChatMessages) {
      merged.push({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt
      });
    }
    for (const note of localChatNotes) {
      merged.push(note);
    }
    if (pendingUserMessage) {
      merged.push(pendingUserMessage);
    }

    merged.sort((a, b) => a.createdAt - b.createdAt);
    return [WELCOME_MESSAGE, ...merged];
  }, [serverChatMessages, localChatNotes, pendingUserMessage]);

  const showOpenAiBanner = healthLoaded && openaiConfigured === false;
  const showUnityProjectBanner =
    healthLoaded &&
    backendMode === "mcp" &&
    unityProjectPathConfigured === false;
  const showOnlineModelsBanner =
    healthLoaded &&
    polyPizzaConfigured === false &&
    sketchfabConfigured === false;

  return (
    <main className="app-shell chat-app-shell">
      <TopBar
        modeEyebrow={modeEyebrow}
        backendStatus={backendStatus}
        statusLabel={statusLabel}
        onCheckBackend={checkBackend}
      />

      <section className="chat-workspace">
        <aside className="left-column">
          <ActivityPanel
            chatToolCalls={chatToolCalls}
            recentManualLogs={recentManualLogs}
          />
          <Library />
        </aside>

        <ChatPanel
          showOpenAiBanner={showOpenAiBanner}
          showUnityProjectBanner={showUnityProjectBanner}
          showOnlineModelsBanner={showOnlineModelsBanner}
          sceneActionSubtitle={sceneActionSubtitle}
          renderedChatMessages={renderedChatMessages}
          isChatBusy={isChatBusy}
          pendingConfirmations={pendingConfirmations}
          resolvingConfirmationKey={resolvingConfirmationKey}
          onResolveConfirmation={(confirmation, action, optionKey) =>
            void resolveConfirmation(confirmation, action, optionKey)
          }
          chatAttachments={chatAttachments}
          isUploadingAttachment={isUploadingAttachment}
          chatAttachmentInputRef={chatAttachmentInputRef}
          onUploadChatAttachment={(file) => void uploadChatAttachment(file)}
          chatInput={chatInput}
          onChatInputChange={setChatInput}
          onSubmitChat={submitChat}
        />
      </section>
    </main>
  );
}
