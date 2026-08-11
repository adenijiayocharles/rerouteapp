import { useState, type ReactNode } from "react";
import type { ColorTokens, ThemePreference } from "../theme";
import type { HistoryRetention } from "../types";
import { CloseIcon, MonitorIcon, MoonIcon, SunIcon, WarningIcon } from "./icons";

interface SettingsModalProps {
  c: ColorTokens;
  helperEnabled: boolean;
  helperActive: boolean;
  launchAtLogin: boolean;
  autoFlushDns: boolean;
  confirmBeforeSave: boolean;
  propagateGroupIps: boolean;
  themePreference: ThemePreference;
  historyRetention: HistoryRetention;
  appVersion: string | null;
  autoCheckUpdates: boolean;
  checkingForUpdates: boolean;
  onClose: () => void;
  onSetHelperEnabled: (enabled: boolean) => void;
  onSetLaunchAtLogin: (enabled: boolean) => void;
  onSetAutoFlushDns: (enabled: boolean) => void;
  onSetConfirmBeforeSave: (enabled: boolean) => void;
  onSetPropagateGroupIps: (enabled: boolean) => void;
  onSetThemePreference: (preference: ThemePreference) => void;
  onSetHistoryRetention: (value: HistoryRetention) => void;
  onSetAutoCheckUpdates: (enabled: boolean) => void;
  onCheckForUpdatesNow: () => void;
}

export function SettingsModal({
  c,
  helperEnabled,
  helperActive,
  launchAtLogin,
  autoFlushDns,
  confirmBeforeSave,
  propagateGroupIps,
  themePreference,
  historyRetention,
  appVersion,
  autoCheckUpdates,
  checkingForUpdates,
  onClose,
  onSetHelperEnabled,
  onSetLaunchAtLogin,
  onSetAutoFlushDns,
  onSetConfirmBeforeSave,
  onSetPropagateGroupIps,
  onSetThemePreference,
  onSetHistoryRetention,
  onSetAutoCheckUpdates,
  onCheckForUpdatesNow,
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
          width: 720,
          background: c.cardBg,
          borderRadius: 14,
          boxShadow: c.popShadow,
          zIndex: 71,
          animation: "hm-pop-in-centered .16s ease",
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
          <SectionLabel c={c}>Appearance</SectionLabel>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: c.text }}>Theme</div>
            <div style={{ display: "flex", gap: 4, background: c.chipBg, borderRadius: 8, padding: 3 }}>
              <ThemeOption c={c} active={themePreference === "light"} onClick={() => onSetThemePreference("light")} icon={<SunIcon size={13} />} label="Light" />
              <ThemeOption c={c} active={themePreference === "dark"} onClick={() => onSetThemePreference("dark")} icon={<MoonIcon size={13} />} label="Dark" />
              <ThemeOption c={c} active={themePreference === "system"} onClick={() => onSetThemePreference("system")} icon={<MonitorIcon size={13} />} label="System" />
            </div>
          </div>

          <SectionLabel c={c}>General</SectionLabel>
          <ToggleRow
            c={c}
            title="Launch at login"
            description=""
            checked={launchAtLogin}
            onToggle={() => onSetLaunchAtLogin(!launchAtLogin)}
          />

          <div style={{ marginTop: 20 }}>
            <SectionLabel c={c}>Updates</SectionLabel>
            <ToggleRow
              c={c}
              title="Automatically check for updates"
              description=""
              checked={autoCheckUpdates}
              onToggle={() => onSetAutoCheckUpdates(!autoCheckUpdates)}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 14 }}>
              <div style={{ fontSize: 12.5, color: c.textMuted }}>
                {appVersion ? `Current version: ${appVersion}` : "Current version unavailable"}
              </div>
              <button
                onClick={onCheckForUpdatesNow}
                disabled={checkingForUpdates}
                style={{
                  height: 30,
                  padding: "0 12px",
                  borderRadius: 7,
                  border: `1px solid ${c.border}`,
                  background: "transparent",
                  color: c.text,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: checkingForUpdates ? "default" : "pointer",
                  opacity: checkingForUpdates ? 0.6 : 1,
                  flex: "none",
                }}
              >
                {checkingForUpdates ? "Checking…" : "Check for Updates"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <SectionLabel c={c}>Behavior</SectionLabel>
            <ToggleRow
              c={c}
              title="Auto-flush DNS on IP switch"
              description=""
              checked={autoFlushDns}
              onToggle={() => onSetAutoFlushDns(!autoFlushDns)}
            />
            <div style={{ marginTop: 14 }}>
              <ToggleRow
                c={c}
                title="Always preview before saving"
                description=""
                checked={confirmBeforeSave}
                onToggle={() => onSetConfirmBeforeSave(!confirmBeforeSave)}
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <ToggleRow
                c={c}
                title="Propagate new IPs to grouped entries"
                description=""
                checked={propagateGroupIps}
                onToggle={() => onSetPropagateGroupIps(!propagateGroupIps)}
              />
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <SectionLabel c={c}>Data</SectionLabel>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: c.text }}>History retention</div>
                <div style={{ fontSize: 12.5, color: c.textMuted, marginTop: 4, lineHeight: 1.5 }}>
                  Older entries are pruned automatically after each change.
                </div>
              </div>
              <select
                value={historyRetention}
                onChange={(e) => onSetHistoryRetention(e.target.value as HistoryRetention)}
                style={{
                  height: 30,
                  padding: "0 8px",
                  borderRadius: 7,
                  border: `1px solid ${c.border}`,
                  background: c.inputBg,
                  color: c.text,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  flex: "none",
                }}
              >
                <option value="50">Last 50</option>
                <option value="100">Last 100</option>
                <option value="200">Last 200</option>
                <option value="unlimited">Unlimited</option>
              </select>
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

function ThemeOption({
  c,
  active,
  onClick,
  icon,
  label,
}: {
  c: ColorTokens;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 6,
        border: "none",
        background: active ? c.cardBg : "transparent",
        boxShadow: active ? "0 1px 2px rgba(0,0,0,.1)" : "none",
        color: active ? c.text : c.textMuted,
        fontSize: 12.5,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {icon}
      {label}
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
