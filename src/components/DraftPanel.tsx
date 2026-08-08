import type { CSSProperties, ReactNode } from "react";
import type { ColorTokens, Theme } from "../theme";
import type { EntryDraft } from "../types";
import { CloseIcon, PlusIcon, TrashIcon, CheckIcon } from "./icons";

interface DraftPanelProps {
  c: ColorTokens;
  theme: Theme;
  draft: EntryDraft;
  onClose: () => void;
  onFieldChange: <K extends "hostname" | "comment" | "group">(field: K, value: string) => void;
  onIpFieldChange: (uid: string, field: "label" | "ip", value: string) => void;
  onAddIpRow: () => void;
  onRemoveIpRow: (uid: string) => void;
  onSetActive: (uid: string) => void;
  onToggleEnabled: () => void;
  onSave: () => void;
  onDelete: () => void;
}

export function DraftPanel({
  c,
  theme,
  draft,
  onClose,
  onFieldChange,
  onIpFieldChange,
  onAddIpRow,
  onRemoveIpRow,
  onSetActive,
  onToggleEnabled,
  onSave,
  onDelete,
}: DraftPanelProps) {
  const isNew = draft.id === null;
  const title = isNew ? "Add entry" : "Edit entry";

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
          background: c.chipBg,
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
            padding: "11px 24px",
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
          <Field label="Hostname" c={c} theme={theme}>
            <input
              value={draft.hostname}
              onChange={(e) => onFieldChange("hostname", e.target.value)}
              placeholder="api.myapp.local, admin.myapp.local"
              style={inputStyle(c, theme, true)}
            />
            <div style={{ fontSize: 11.5, color: theme === "light" ? c.textMuted : c.textFaint, marginTop: 6 }}>
              Separate multiple hostnames with commas or spaces to point them all at the same IP.
            </div>
          </Field>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label style={labelStyle(c, theme)}>IP addresses</label>
              <button
                onClick={onAddIpRow}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: c.accent,
                  background: "transparent",
                  border: "none",
                  textTransform: "uppercase",
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
                      style={{ ...inputStyle(c, theme, false), width: 76, height: 28, fontSize: 12 }}
                    />
                    <input
                      value={row.ip}
                      onChange={(e) => onIpFieldChange(row.uid, "ip", e.target.value)}
                      placeholder="127.0.0.1"
                      style={{ ...inputStyle(c, theme, true), flex: 1, height: 28, fontSize: 12.5, minWidth: 0 }}
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
            {!isNew && (
              <div style={{ flex: 1 }}>
                <label style={labelStyle(c, theme)}>Comment</label>
                <input
                  value={draft.comment}
                  onChange={(e) => onFieldChange("comment", e.target.value)}
                  placeholder="Optional note"
                  style={{ ...inputStyle(c, theme, false), marginTop: 6 }}
                />
              </div>
            )}
            <div style={{ flex: 1 }}>
              <label style={labelStyle(c, theme)}>Group</label>
              <input
                value={draft.group}
                onChange={(e) => onFieldChange("group", e.target.value)}
                placeholder="e.g. Work"
                style={{ ...inputStyle(c, theme, false), marginTop: 6 }}
              />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 4 }}>
            <div style={labelStyle(c, theme)}>ENABLED</div>
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
          {!isNew && (
            <button
              onClick={onDelete}
              style={{
                height: 38,
                padding: "0 16px",
                borderRadius: 8,
                border: "none",
                background: "#b91c1c",
                textTransform: "uppercase",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              width: 100,
              height: 38,
              borderRadius: 8,
              border: `1px solid ${c.border}`,
              background: "transparent",
              color: c.text,
              textTransform: "uppercase",
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
              width: 140,
              height: 38,
              textTransform: "uppercase",
              borderRadius: 8,
              border: "none",
              background: c.accent,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {isNew ? "Save" : "Review changes"}
          </button>
        </div>
      </div>
    </>
  );
}

function Field({ label, c, theme, children }: { label: string; c: ColorTokens; theme: Theme; children: ReactNode }) {
  return (
    <div>
      <label style={labelStyle(c, theme)}>{label}</label>
      <div style={{ marginTop: 6 }}>{children}</div>
    </div>
  );
}

function labelStyle(c: ColorTokens, theme: Theme): CSSProperties {
  return {
    fontSize: 11.5,
    fontWeight: 700,
    color: theme === "light" ? c.textMuted : c.textFaint,
    textTransform: "uppercase",
    letterSpacing: ".04em",
  };
}

function inputStyle(c: ColorTokens, theme: Theme, mono: boolean): CSSProperties {
  return {
    width: "100%",
    height: 36,
    padding: "0 12px",
    borderRadius: 8,
    border: theme === "light" ? "1px solid rgba(15,15,20,0.18)" : `1px solid ${c.border}`,
    background: c.inputBg,
    color: c.text,
    fontFamily: mono ? "'JetBrains Mono',monospace" : "inherit",
    fontSize: 13,
    outline: "none",
  };
}
