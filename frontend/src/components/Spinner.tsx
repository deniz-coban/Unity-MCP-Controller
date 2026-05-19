/**
 * Loading indicator styled like Unity's XYZ transform gizmo:
 * three colored arrows (red/green/blue) 120° apart from the center.
 * The whole SVG rotates in 120° steps so each arrow visually snaps
 * into the position the next one held a moment ago.
 *
 * The rotation animation lives in styles.css under `.spinner`.
 */
export function Spinner() {
  const arms: Array<{ rotation: number; color: string }> = [
    { rotation: 0, color: "#ef4444" }, // X — red
    { rotation: 120, color: "#22c55e" }, // Y — green
    { rotation: 240, color: "#3b82f6" } // Z — blue
  ];

  return (
    <svg
      aria-hidden="true"
      className="spinner"
      viewBox="-50 -50 100 100"
    >
      {arms.map((arm) => (
        <g key={arm.rotation} transform={`rotate(${arm.rotation})`}>
          <line
            x1="0"
            y1="0"
            x2="28"
            y2="0"
            stroke={arm.color}
            strokeWidth="7"
            strokeLinecap="butt"
          />
          <polygon
            points="44,0 28,-11 28,11"
            fill={arm.color}
            stroke="none"
          />
        </g>
      ))}
    </svg>
  );
}
