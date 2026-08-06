import { useState } from "react";
import type { ColorTokens } from "../theme";
import type { DiffPreview } from "../types";
import { WarningIcon } from "./icons";

interface DiffModalProps {
  c: ColorTokens;
  diff: DiffPreview;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DiffModal({ c, diff, onCancel, onConfirm }: DiffModalProps) {
  const [shadowAck, setShadowAck] = useState(false);

  const cancelLabel = diff.mode === "view" ? "Close" : "Cancel";
  const showConfirm = diff.mode !== "view";
  const confirmLabel = diff.mode === "restore" ? "Restore version" : "Write to hosts file";
  const confirmDisabled = diff.isShadowDomain && diff.mode === "save" && !shadowAck;

  return (
    <>
      <div
        style={{ position: "absolute", inset: 0, background: c.overlay, zIndex: 70, animation: "hm-fade-in .15s ease" }}
        onClick={onCancel}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 560,
          background: c.cardBg,
          borderRadius: 14,
          boxShadow: c.popShadow,
          zIndex: 71,
          animation: "hm-pop-in .16s ease",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "20px 24px 4px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: c.text }}>{diff.title}</div>
          <div style={{ fontSize: 12.5, color: c.textMuted, marginTop: 3 }}>{diff.subtitle}</div>
        </div>

        {diff.isShadowDomain && diff.mode === "save" && (
          <div style={{ padding: "12px 24px 0" }}>
            <div
              style={{
                display: "flex",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 10,
                background: c.redSoft,
                border: `1px solid ${c.red}`,
              }}
            >
              <WarningIcon size={16} color={c.red} />
              <div style={{ fontSize: 12.5, color: c.text, lineHeight: 1.5 }}>
                <strong>This hostname is a well-known system domain.</strong> Overriding it can affect other
                applications and services on this machine that rely on it resolving normally.
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 8,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  <input type="checkbox" checked={shadowAck} onChange={(e) => setShadowAck(e.target.checked)} />
                  I understand the risk and want to proceed
                </label>
              </div>
            </div>
          </div>
        )}

        <div style={{ padding: "16px 24px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.textFaint, textTransform: "uppercase", letterSpacing: ".04em" }}>
            hosts file
          </div>
          <div style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${c.border}`, fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5 }}>
            <div style={{ padding: "9px 6px 9px 8px", color: c.textFaint }}>…</div>
            {diff.beforeLine && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "9px 6px 9px 8px",
                  background: c.redSoft,
                  color: c.red,
                  textDecoration: "line-through",
                  textDecorationColor: c.red,
                }}
              >
                <span style={{ flex: "none", fontWeight: 700 }}>−</span>
                <span style={{ whiteSpace: "pre" }}>{diff.beforeLine}</span>
              </div>
            )}
            {diff.afterLine && (
              <div style={{ display: "flex", gap: 8, padding: "9px 6px 9px 8px", background: c.greenSoft, color: c.green }}>
                <span style={{ flex: "none", fontWeight: 700 }}>+</span>
                <span style={{ whiteSpace: "pre" }}>{diff.afterLine}</span>
              </div>
            )}
            <div style={{ padding: "9px 6px 9px 8px", color: c.textFaint }}>…</div>
          </div>
        </div>

        <div style={{ padding: "16px 24px 20px", display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              height: 38,
              borderRadius: 8,
              border: `1px solid ${c.border}`,
              background: "transparent",
              color: c.text,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          {showConfirm && (
            <button
              onClick={onConfirm}
              disabled={confirmDisabled}
              style={{
                flex: 1,
                height: 38,
                borderRadius: 8,
                border: "none",
                background: c.accent,
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: confirmDisabled ? "not-allowed" : "pointer",
                opacity: confirmDisabled ? 0.5 : 1,
              }}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
