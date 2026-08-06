import type { CSSProperties, ReactNode } from "react";
import type { ColorTokens } from "../theme";
import type { EntryDraft } from "../types";
import { CloseIcon, PlusIcon, TrashIcon, CheckIcon } from "./icons";

interface DraftPanelProps {
  c: ColorTokens;
  draft: EntryDraft;
  onClose: () => void;
  onFieldChange: <K extends "hostname" | "comment" | "group">(field: K, value: string) => void;
  onIpFieldChange: (uid: string, field: "label" | "ip", value: string) => void;
  onAddIpRow: () => void;
  onRemoveIpRow: (uid: string) => void;
  onSetActive: (uid: string) => void;
  onToggleEnabled: () => void;
  onSave: () => void;
}

export function DraftPanel({
  c,
  draft,
  onClose,
  onFieldChange,
  onIpFieldChange,
  onAddIpRow,
  onRemoveIpRow,
  onSetActive,
  onToggleEnabled,
  onSave,
}: DraftPanelProps) {
  const title = draft.id === null ? "Add entry" : "Edit entry";

  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: c.overlay,
          zIndex: 50,
          animation: "hm-fade-in .15s ease",
        }}
        onClick={onClose}
      />
      <div
        className="hm-scroll"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 440,
          background: c.bg,
          borderLeft: `1px solid ${c.border}`,
          boxShadow: c.popShadow,
          zIndex: 51,
          animation: "hm-slide-in .2s ease",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${c.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flex: "none",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: c.text }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              border: "none",
              background: "transparent",
              color: c.textFaint,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CloseIcon />
          </button>
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18, flex: 1 }}>
          <Field label="Hostname" c={c}>
            <input
              value={draft.hostname}
              onChange={(e) => onFieldChange("hostname", e.target.value)}
              placeholder="api.myapp.local"
              style={inputStyle(c, true)}
            />
          </Field>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label style={labelStyle(c)}>IP addresses</label>
              <button
                onClick={onAddIpRow}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: c.accent,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <PlusIcon size={12} />
                Add
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {draft.ips.map((row) => {
                const active = draft.activeUid === row.uid;
                return (
                  <div
                    key={row.uid}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: 8,
                      border: `1px solid ${c.border}`,
                      borderRadius: 9,
                      background: c.inputBg,
                    }}
                  >
                    <button
                      onClick={() => onSetActive(row.uid)}
                      title="Set active"
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        flex: "none",
                        border: `1.5px solid ${active ? c.accent : c.textFaint}`,
                        background: active ? c.accent : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      {active && <CheckIcon size={9} />}
                    </button>
                    <input
                      value={row.label}
                      onChange={(e) => onIpFieldChange(row.uid, "label", e.target.value)}
                      placeholder="Label"
                      style={{ ...inputStyle(c, false), width: 76, height: 28, fontSize: 12 }}
                    />
                    <input
                      value={row.ip}
                      onChange={(e) => onIpFieldChange(row.uid, "ip", e.target.value)}
                      placeholder="127.0.0.1"
                      style={{ ...inputStyle(c, true), flex: 1, height: 28, fontSize: 12.5, minWidth: 0 }}
                    />
                    <button
                      onClick={() => onRemoveIpRow(row.uid)}
                      disabled={draft.ips.length <= 1}
                      style={{
                        width: 26,
                        height: 26,
                        flex: "none",
                        borderRadius: 6,
                        border: "none",
                        background: "transparent",
                        color: c.textFaint,
                        cursor: draft.ips.length <= 1 ? "not-allowed" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: draft.ips.length <= 1 ? 0.4 : 1,
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle(c)}>Comment</label>
              <input
                value={draft.comment}
                onChange={(e) => onFieldChange("comment", e.target.value)}
                placeholder="Optional note"
                style={{ ...inputStyle(c, false), marginTop: 6 }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle(c)}>Group</label>
              <input
                value={draft.group}
                onChange={(e) => onFieldChange("group", e.target.value)}
                placeholder="e.g. Work"
                style={{ ...inputStyle(c, false), marginTop: 6 }}
              />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: c.text }}>Enabled</div>
            <button
              onClick={onToggleEnabled}
              style={{
                width: 38,
                height: 22,
                borderRadius: 11,
                border: "none",
                padding: 2,
                cursor: "pointer",
                background: draft.enabled ? c.green : c.chipBg,
                display: "flex",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 1px 2px rgba(0,0,0,.25)",
                  transform: draft.enabled ? "translateX(16px)" : "translateX(0)",
                  transition: "transform .15s ease",
                }}
              />
            </button>
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${c.border}`, display: "flex", gap: 10, flex: "none" }}>
          <button
            onClick={onClose}
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
            Cancel
          </button>
          <button
            onClick={onSave}
            style={{
              flex: 1,
              height: 38,
              borderRadius: 8,
              border: "none",
              background: c.accent,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Review changes
          </button>
        </div>
      </div>
    </>
  );
}

function Field({ label, c, children }: { label: string; c: ColorTokens; children: ReactNode }) {
  return (
    <div>
      <label style={labelStyle(c)}>{label}</label>
      <div style={{ marginTop: 6 }}>{children}</div>
    </div>
  );
}

function labelStyle(c: ColorTokens): CSSProperties {
  return {
    fontSize: 11.5,
    fontWeight: 700,
    color: c.textFaint,
    textTransform: "uppercase",
    letterSpacing: ".04em",
  };
}

function inputStyle(c: ColorTokens, mono: boolean): CSSProperties {
  return {
    width: "100%",
    height: 36,
    padding: "0 12px",
    borderRadius: 8,
    border: `1px solid ${c.border}`,
    background: c.inputBg,
    color: c.text,
    fontFamily: mono ? "'JetBrains Mono',monospace" : "inherit",
    fontSize: 13,
    outline: "none",
  };
}
