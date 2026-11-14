export default function Sitelink({ onBack }) {
  return (
    <div className="sl" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            style={{
              border: "1.5px solid currentColor",
              background: "transparent",
              color: "inherit",
              borderRadius: 10,
              padding: "9px 12px",
              fontSize: 18,
              lineHeight: 1,
              cursor: "pointer",
              opacity: 0.8,
            }}
          >
            ←
          </button>
        )}
        <h2 style={{ margin: 0, fontSize: 22 }}>Sitelink</h2>
      </div>

      <p style={{ textAlign: "center", margin: "60px 0", opacity: 0.7 }}>
        This dashboard will be built in Later Stage
      </p>
    </div>
  );
}