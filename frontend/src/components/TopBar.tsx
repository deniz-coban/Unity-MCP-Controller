import type { BackendStatus } from "../helpers";

interface TopBarProps {
  modeEyebrow: string;
  backendStatus: BackendStatus;
  statusLabel: string;
  onCheckBackend: () => void;
}

export function TopBar({
  modeEyebrow,
  backendStatus,
  statusLabel,
  onCheckBackend
}: TopBarProps) {
  return (
    <section className="top-bar app-header">
      <div>
        <p className="eyebrow">{modeEyebrow}</p>
        <h1>Unity MCP Controller</h1>
      </div>
      <div className="header-actions">
        <button className={`status-pill ${backendStatus}`} onClick={onCheckBackend}>
          <span />
          {statusLabel}
        </button>
      </div>
    </section>
  );
}
