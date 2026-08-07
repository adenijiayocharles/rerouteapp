import { useState, type ReactNode } from "react";
import type { ColorTokens } from "../theme";
import { CloseIcon, WarningIcon } from "./icons";

interface SettingsModalProps {
  c: ColorTokens;
  helperEnabled: boolean;
  helperActive: boolean;
  launchAtLogin: boolean;
  autoFlushDns: boolean;
  confirmBeforeSave: boolean;
  onClose: () => void;
  onSetHelperEnabled: (enabled: boolean) => void;
  onSetLaunchAtLogin: (enabled: boolean) => void;
  onSetAutoFlushDns: (enabled: boolean) => void;
  onSetConfirmBeforeSave: (enabled: boolean) => void;
}

export function SettingsModal({
  c,
  helperEnabled,
  helperActive,
  launchAtLogin,
  autoFlushDns,
  confirmBeforeSave,
  onClose,
  onSetHelperEnabled,
  onSetLaunchAtLogin,
  onSetAutoFlushDns,
  onSetConfirmBeforeSave,
}: SettingsModalProps) {
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  function handleToggleClick() {
    if (helperEnabled) {
      setConfirmingDisable(true);
    } else {
      onSetHelperEnabled(true);
    }
  }

  function handleConfirmDisable() {
    setConfirmingDisable(false);
    onSetHelperEnabled(false);
  }

  return (
    <>
      <div
        style={{ position: "absolute", inset: 0, background: c.overlay, zIndex: 70, animation: "hm-fade-in .15s ease" }}
        onClick={onClose}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 480,
          background: c.cardBg,
          borderRadius: 14,
          boxShadow: c.popShadow,
          zIndex: 71,
          animation: "hm-pop-in .16s ease",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 4px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: c.text }}>Settings</div>
          <button
            onClick={onClose}
            style={{ width: 26, height: 26, borderRadius: 7, border: "none", background: "transparent", color: c.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <CloseIcon color={c.textMuted} />
          </button>
        </div>

        <div style={{ padding: "16px 20px 20px" }}>
          <SectionLabel c={c}>General</SectionLabel>
          <ToggleRow
            c={c}
            title="Launch at login"
            description="Start Hosts Manager automatically when you sign in."
            checked={launchAtLogin}
            onToggle={() => onSetLaunchAtLogin(!launchAtLogin)}
          />

          <div style={{ marginTop: 20 }}>
            <SectionLabel c={c}>Behavior</SectionLabel>
            <ToggleRow
              c={c}
              title="Auto-flush DNS on IP switch"
              description="Flush the local DNS resolver cache whenever an entry's active IP changes."
              checked={autoFlushDns}
              onToggle={() => onSetAutoFlushDns(!autoFlushDns)}
            />
            <div style={{ marginTop: 14 }}>
              <ToggleRow
                c={c}
                title="Always preview before saving"
                description="Show the diff confirmation for every save, including brand-new entries."
                checked={confirmBeforeSave}
                onToggle={() => onSetConfirmBeforeSave(!confirmBeforeSave)}
              />
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <SectionLabel c={c}>Background helper</SectionLabel>

            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: c.text }}>Write without a password prompt</div>
                <div style={{ fontSize: 12.5, color: c.textMuted, marginTop: 4, lineHeight: 1.5 }}>
                  Installs a small privileged helper (one admin prompt) so hosts file writes and DNS flushes happen
                  silently afterward.
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: helperActive ? c.green : c.textFaint,
                      flex: "none",
                    }}
                  />
                  <span style={{ fontSize: 11.5, color: c.textFaint }}>
                    {helperActive ? "Active" : helperEnabled ? "Not installed yet" : "Disabled"}
                  </span>
                </div>
              </div>
              <ToggleSwitch checked={helperEnabled} onToggle={handleToggleClick} c={c} ariaLabel="Toggle background helper" />
            </div>
          </div>

          {confirmingDisable && (
            <div
              style={{
                display: "flex",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 10,
                background: c.redSoft,
                border: `1px solid ${c.red}`,
                marginTop: 14,
              }}
            >
              <WarningIcon size={16} color={c.red} />
              <div style={{ fontSize: 12.5, color: c.text, lineHeight: 1.5, flex: 1 }}>
                <strong>Turning this off means every hosts file write will prompt for your password.</strong>
                {helperActive && " The currently-installed helper will also be removed."}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    onClick={() => setConfirmingDisable(false)}
                    style={{
                      height: 30,
                      padding: "0 12px",
                      borderRadius: 7,
                      border: `1px solid ${c.border}`,
                      background: "transparent",
                      color: c.text,
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmDisable}
                    style={{
                      height: 30,
                      padding: "0 12px",
                      borderRadius: 7,
                      border: "none",
                      background: c.red,
                      color: "#fff",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Turn off
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SectionLabel({ c, children }: { c: ColorTokens; children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: c.textFaint, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 10 }}>
      {children}
    </div>
  );
}

function ToggleSwitch({ c, checked, onToggle, ariaLabel }: { c: ColorTokens; checked: boolean; onToggle: () => void; ariaLabel: string }) {
  return (
    <button
      onClick={onToggle}
      aria-label={ariaLabel}
      style={{
        width: 38,
        height: 22,
        borderRadius: 11,
        border: "none",
        padding: 2,
        cursor: "pointer",
        background: checked ? c.green : c.chipBg,
        display: "flex",
        alignItems: "center",
        flex: "none",
        marginTop: 2,
      }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,.25)",
          transform: checked ? "translateX(16px)" : "translateX(0)",
          transition: "transform .15s ease",
        }}
      />
    </button>
  );
}

function ToggleRow({
  c,
  title,
  description,
  checked,
  onToggle,
}: {
  c: ColorTokens;
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: c.text }}>{title}</div>
        <div style={{ fontSize: 12.5, color: c.textMuted, marginTop: 4, lineHeight: 1.5 }}>{description}</div>
      </div>
      <ToggleSwitch checked={checked} onToggle={onToggle} c={c} ariaLabel={title} />
    </div>
  );
}
