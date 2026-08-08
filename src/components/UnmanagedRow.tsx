import { memo } from "react";
import type { ColorTokens } from "../theme";
import type { UnmanagedEntry } from "../types";
import { PlusIcon } from "./icons";
import { gridTemplate } from "./EntryRow";

interface UnmanagedRowProps {
  c: ColorTokens;
  entry: UnmanagedEntry;
  disabled: boolean;
  onAdopt: (id: string) => void;
}

export const UnmanagedRow = memo(function UnmanagedRow({ c, entry, disabled, onAdopt }: UnmanagedRowProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: gridTemplate,
        gap: 14,
        alignItems: "center",
        padding: "13px 14px",
        borderBottom: `1px solid ${c.rowBorder}`,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = c.rowHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: c.textFaint, margin: "0 auto" }} />

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 13,
            fontWeight: 600,
            color: c.textMuted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.hostname}
        </div>
      </div>

      <div
        style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 12.5,
          color: c.textMuted,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {entry.ip}
      </div>

      <div style={{ fontSize: 12.5, color: c.textFaint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {entry.comment || "—"}
      </div>

      <div style={{ gridColumn: "span 2" }}>
        <button
          onClick={() => onAdopt(entry.id)}
          disabled={disabled}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 12px",
            borderRadius: 8,
            border: `1px solid ${c.border}`,
            background: c.chipBg,
            color: c.text,
            fontSize: 12,
            fontWeight: 600,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          <PlusIcon size={11} />
          Adopt
        </button>
      </div>
    </div>
  );
});
