import {
  FormEvent,
  KeyboardEvent,
  RefObject,
  useEffect,
  useRef
} from "react";
import { Spinner } from "./Spinner";
import type {
  ChatAttachment,
  PendingConfirmation
} from "../types";
import type { DisplayChatMessage } from "../helpers";

interface ChatPanelProps {
  showOpenAiBanner: boolean;
  showUnityProjectBanner: boolean;
  showOnlineModelsBanner: boolean;
  sceneActionSubtitle: string;
  renderedChatMessages: DisplayChatMessage[];
  isChatBusy: boolean;
  pendingConfirmations: PendingConfirmation[];
  resolvingConfirmationKey: string | null;
  onResolveConfirmation: (
    confirmation: PendingConfirmation,
    action: "confirm" | "cancel",
    optionKey?: string
  ) => void;
  chatAttachments: ChatAttachment[];
  isUploadingAttachment: boolean;
  chatAttachmentInputRef: RefObject<HTMLInputElement>;
  onUploadChatAttachment: (file: File) => void;
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSubmitChat: (event: FormEvent<HTMLFormElement>) => void;
}

export function ChatPanel({
  showOpenAiBanner,
  showUnityProjectBanner,
  showOnlineModelsBanner,
  sceneActionSubtitle,
  renderedChatMessages,
  isChatBusy,
  pendingConfirmations,
  resolvingConfirmationKey,
  onResolveConfirmation,
  chatAttachments,
  isUploadingAttachment,
  chatAttachmentInputRef,
  onUploadChatAttachment,
  chatInput,
  onChatInputChange,
  onSubmitChat
}: ChatPanelProps) {
  const historyRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const el = historyRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [renderedChatMessages, pendingConfirmations, isChatBusy]);

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // event.nativeEvent.isComposing guards against firing during IME composition
    // (e.g. when typing CJK characters with an input method editor).
    const isComposing =
      (event.nativeEvent as { isComposing?: boolean }).isComposing === true;
    if (event.key === "Enter" && !event.shiftKey && !isComposing) {
      event.preventDefault();
      if (chatInput.trim() && !isChatBusy) {
        formRef.current?.requestSubmit();
      }
    }
  };

  return (
    <section className="chat-panel">
      {showOpenAiBanner ? (
        <div className="chat-banner warn" role="alert">
          <strong>OpenAI chat is not configured.</strong>
          <span>
            Set OPENAI_API_KEY in backend/.env and restart the backend to
            enable chat.
          </span>
        </div>
      ) : null}
      {showUnityProjectBanner ? (
        <div className="chat-banner info" role="status">
          <strong>Model import via chat is unavailable.</strong>
          <span>
            Set UNITY_PROJECT_PATH in backend/.env and restart the backend
            so uploaded models can be copied into your Unity project.
          </span>
        </div>
      ) : null}
      {showOnlineModelsBanner ? (
        <div className="chat-banner info" role="status">
          <strong>Online model search is disabled.</strong>
          <span>
            Set POLY_PIZZA_API_KEY and/or SKETCHFAB_API_TOKEN in backend/.env
            and restart the backend to enable "find a bicycle online" style
            requests.
          </span>
        </div>
      ) : null}
      <div className="chat-panel-heading">
        <div>
          <p className="eyebrow">AI SCENE BUILDER</p>
          <h2>Tell Unity what to build</h2>
        </div>
        <p>{sceneActionSubtitle}</p>
      </div>
      <div className="chat-history" aria-live="polite" ref={historyRef}>
        {renderedChatMessages.map((message) => {
          const roleLabel =
            message.role === "user"
              ? "You"
              : message.role === "system"
                ? "System"
                : "Assistant";

          return (
            <article
              className={`chat-message ${message.role}`}
              key={message.id}
            >
              <span>{roleLabel}</span>
              {message.details && message.details.length > 0 ? (
                <ul>
                  {message.details.map((detail, index) => (
                    <li key={`${message.id}-detail-${index}`}>{detail}</li>
                  ))}
                </ul>
              ) : (
                <p>{message.content}</p>
              )}
            </article>
          );
        })}
        {isChatBusy ? (
          <article className="chat-message assistant pending">
            <span>Assistant</span>
            <p>
              <Spinner /> Thinking and calling Unity tools...
            </p>
          </article>
        ) : null}
      </div>
      {pendingConfirmations.length > 0 ? (
        <div className="confirmation-stack" role="region" aria-label="Pending confirmations">
          {pendingConfirmations.map((confirmation) => {
            const isResolving =
              resolvingConfirmationKey === confirmation.key;
            const hasOptions =
              confirmation.options && confirmation.options.length > 0;
            const eyebrow =
              confirmation.kind === "select_model"
                ? "Pick a model"
                : "Confirm action";

            return (
              <article
                className={`confirmation-card ${confirmation.kind}`}
                key={confirmation.key}
              >
                <header>
                  <span className="confirmation-eyebrow">{eyebrow}</span>
                  <h3>{confirmation.title}</h3>
                </header>
                <p className="confirmation-description">
                  {confirmation.description}
                </p>

                {hasOptions ? (
                  <div
                    className="confirmation-options"
                    role="list"
                    aria-label="Candidate options"
                  >
                    {confirmation.options!.map((option) => (
                      <article
                        className="confirmation-option"
                        key={option.key}
                        role="listitem"
                      >
                        {option.thumbnailUrl ? (
                          <img
                            alt={option.label}
                            className="confirmation-option-thumb"
                            loading="lazy"
                            src={option.thumbnailUrl}
                          />
                        ) : (
                          <div
                            aria-hidden="true"
                            className="confirmation-option-thumb placeholder"
                          />
                        )}
                        <div className="confirmation-option-body">
                          {option.metaLabel ? (
                            <span className="confirmation-option-meta">
                              {option.metaLabel}
                            </span>
                          ) : null}
                          <strong>{option.label}</strong>
                          <span className="confirmation-option-description">
                            {option.description}
                          </span>
                          <button
                            className="confirmation-option-pick"
                            disabled={isResolving}
                            onClick={() =>
                              onResolveConfirmation(
                                confirmation,
                                "confirm",
                                option.key
                              )
                            }
                            type="button"
                          >
                            {isResolving ? (
                              <>
                                <Spinner /> Working
                              </>
                            ) : (
                              "Pick this"
                            )}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}

                <div className="confirmation-actions">
                  <button
                    className="secondary-button"
                    disabled={isResolving}
                    onClick={() => onResolveConfirmation(confirmation, "cancel")}
                    type="button"
                  >
                    {confirmation.cancelLabel || "Cancel"}
                  </button>
                  {hasOptions ? null : (
                    <button
                      className="confirmation-danger"
                      disabled={isResolving}
                      onClick={() => onResolveConfirmation(confirmation, "confirm")}
                      type="button"
                    >
                      {isResolving ? (
                        <>
                          <Spinner /> Running
                        </>
                      ) : (
                        confirmation.confirmLabel || "Confirm"
                      )}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      <div className="chat-attachments">
        <div>
          <strong>Attachments</strong>
          <span>
            Upload a model or texture, then reference it in chat. Files stay local
            to this backend session.
          </span>
        </div>
        <div className="file-input-row">
          <input
            accept=".fbx,.obj,.png,.jpg,.jpeg"
            aria-label="Chat attachment"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onUploadChatAttachment(file);
              }
            }}
            ref={chatAttachmentInputRef}
            type="file"
          />
          <button disabled={isUploadingAttachment} type="button">
            {isUploadingAttachment ? "Uploading..." : "Attach"}
          </button>
        </div>
        {chatAttachments.length > 0 ? (
          <div className="attachment-list">
            {chatAttachments.map((attachment) => (
              <span key={attachment.id}>
                {attachment.kind}: {attachment.originalName}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <form className="chat-input-row" onSubmit={onSubmitChat} ref={formRef}>
        <textarea
          disabled={isChatBusy}
          onChange={(event) => onChatInputChange(event.target.value)}
          onKeyDown={handleTextareaKeyDown}
          placeholder="Describe what you want to build in Unity..."
          value={chatInput}
        />
        <button disabled={isChatBusy || !chatInput.trim()} type="submit">
          {isChatBusy ? (
            <>
              <Spinner /> Sending
            </>
          ) : (
            "Send"
          )}
        </button>
      </form>
    </section>
  );
}
