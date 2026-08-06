import type { ColorTokens } from "../theme";
import type { HistoryEntry } from "../types";
import { HistoryIcon } from "./icons";

interface HistoryViewProps {
  c: ColorTokens;
  history: HistoryEntry[];
  onViewDiff: (id: string) => void;
  onRestore: (id: string) => void;
}

export function HistoryView({ c, history, onViewDiff, onRestore }: HistoryViewProps) {
  return (
    <div className="hm-scroll" style={{ flex: 1, overflow: "auto" }}>
      <div style={{ padding: "24px 28px 20px" }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: c.text, letterSpacing: "-0.01em" }}>History</div>
        <div style={{ fontSize: 12.5, color: c.textMuted, marginTop: 2 }}>
          Backups of every change, restorable at any point
        </div>
      </div>
      <div style={{ padding: "0 28px 28px", display: "flex", flexDirection: "column", gap: 10 }}>
        {history.map((h) => (
          <div
            key={h.id}
            style={{
              background: c.cardBg,
              border: `1px solid ${c.border}`,
              borderRadius: 12,
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                background: c.accentSoft,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
              }}
            >
              <HistoryIcon size={15} color={c.accent} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600, color: c.text }}>
                  {h.hostname}
                </span>
                <span style={{ fontSize: 12, color: c.textMuted }}>{h.action}</span>
              </div>
              <div style={{ fontSize: 11.5, color: c.textFaint, marginTop: 2 }}>{h.time}</div>
            </div>
            <button
              onClick={() => onViewDiff(h.id)}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 7,
                border: `1px solid ${c.border}`,
                background: "transparent",
                color: c.textMuted,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              View diff
            </button>
            <button
              onClick={() => onRestore(h.id)}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 7,
                border: "none",
                background: c.chipBg,
                color: c.text,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Restore
            </button>
          </div>
        ))}
        {history.length === 0 && (
          <div style={{ padding: "48px 20px", textAlign: "center", color: c.textFaint, fontSize: 13 }}>
            No changes yet.
          </div>
        )}
      </div>
    </div>
  );
}
