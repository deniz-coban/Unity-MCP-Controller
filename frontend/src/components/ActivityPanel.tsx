import type { ChatToolCall } from "../types";
import type { LogEntry } from "../helpers";

const formatToolArguments = (value: unknown): string => {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) {
    return "No arguments";
  }

  try {
    const text = JSON.stringify(value);
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
  } catch {
    return String(value);
  }
};

interface ActivityPanelProps {
  chatToolCalls: ChatToolCall[];
  recentManualLogs: LogEntry[];
}

export function ActivityPanel({
  chatToolCalls,
  recentManualLogs
}: ActivityPanelProps) {
  return (
    <aside className="activity-panel">
      <div className="panel-heading">
        <h2>Tool-call log</h2>
        <p>High-level app tools only. Raw Unity MCP tools stay hidden.</p>
      </div>
      <div className="activity-list">
        {chatToolCalls.length === 0 ? (
          <p className="empty-log">No chat tool calls yet.</p>
        ) : (
          chatToolCalls.slice(0, 12).map((toolCall) => (
            <article className={`activity-entry ${toolCall.status}`} key={toolCall.id}>
              <div>
                <strong>{toolCall.toolName}</strong>
                <span>{toolCall.status}</span>
              </div>
              <code>{formatToolArguments(toolCall.arguments)}</code>
              <p>{toolCall.result ?? toolCall.error ?? "Running..."}</p>
            </article>
          ))
        )}
      </div>
      <div className="recent-manual-log">
        <h2>Recent activity</h2>
        {recentManualLogs.length === 0 ? (
          <p className="empty-log">No manual activity.</p>
        ) : (
          recentManualLogs.map((log) => (
            <article className={`mini-log ${log.tone}`} key={log.id}>
              <strong>{log.title}</strong>
              {log.details?.[0] ? <span>{log.details[0]}</span> : null}
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
