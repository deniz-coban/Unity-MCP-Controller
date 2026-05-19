export function Library() {
  return (
    <aside className="library-panel">
      <div className="panel-corners-top">
        <h2>Library</h2>
        <span className="subtle">Local</span>
      </div>
      <div className="library-empty">
        <div className="library-empty-icon" aria-hidden="true" />
        <span>No items</span>
        <span className="hint">
          Upload textures and models here. (coming soon)
        </span>
      </div>
    </aside>
  );
}
