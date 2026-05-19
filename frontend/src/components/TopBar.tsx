import type { BackendStatus } from "../helpers";

interface TopBarProps {
  modeEyebrow: string;
  backendStatus: BackendStatus;
  statusLabel: string;
  onCheckBackend: () => void;
  onOpenManualTools: () => void;
}

export function TopBar({
  modeEyebrow,
  backendStatus,
  statusLabel,
  onCheckBackend,
  onOpenManualTools
}: TopBarProps) {
  return (
    <section className="top-bar app-header">
      <div>
        <p className="eyebrow">{modeEyebrow}</p>
        <h1>Unity MCP Controller</h1>
      </div>
      <div className="header-actions">
        <button
          className="manual-tools-button"
          onClick={onOpenManualTools}
          type="button"
        >
          Manual tools
        </button>
        <button className={`status-pill ${backendStatus}`} onClick={onCheckBackend}>
          <span />
          {statusLabel}
        </button>
      </div>
    </section>
  );
}
