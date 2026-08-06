import type { CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ColorTokens, Theme } from "../theme";
import type { Entry } from "../types";
import { MoonIcon, SunIcon, TrayIcon } from "./icons";
import { QuickSwitchTray } from "./QuickSwitchTray";

interface TitleBarProps {
  c: ColorTokens;
  theme: Theme;
  onToggleTheme: () => void;
  trayOpen: boolean;
  onToggleTray: () => void;
  onCloseTray: () => void;
  entries: Entry[];
  onSwitchIp: (entryId: string, ipId: string) => void;
  onFlushDns: () => void;
}

const appWindow = getCurrentWindow();

function TrafficLight({ color, onClick, label }: { color: string; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: color,
        border: "none",
        padding: 0,
        cursor: "pointer",
      }}
    />
  );
}

export function TitleBar({
  c,
  theme,
  onToggleTheme,
  trayOpen,
  onToggleTray,
  onCloseTray,
  entries,
  onSwitchIp,
  onFlushDns,
}: TitleBarProps) {
  const isDark = theme === "dark";
  return (
    <div
      data-tauri-drag-region
      style={{
        height: 52,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 16px",
        background: c.titlebar,
        borderBottom: `1px solid ${c.border}`,
        transition: "background .25s ease,border-color .25s ease",
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <TrafficLight color="#ff5f57" label="Close" onClick={() => appWindow.close()} />
        <TrafficLight color="#febc2e" label="Minimize" onClick={() => appWindow.minimize()} />
        <TrafficLight color="#28c840" label="Maximize" onClick={() => appWindow.toggleMaximize()} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: c.text, letterSpacing: "-0.01em" }}>Hosts Manager</div>
      <div style={{ flex: 1 }} />
      <button
        onClick={onFlushDns}
        title="Flush DNS now"
        style={titleBarButtonStyle(c)}
        onMouseEnter={(e) => (e.currentTarget.style.background = c.rowHover)}
        onMouseLeave={(e) => (e.currentTarget.style.background = c.trayBtnBg)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      </button>
      <div style={{ position: "relative" }}>
        <button
          onClick={onToggleTray}
          title="Quick switcher"
          style={titleBarButtonStyle(c)}
          onMouseEnter={(e) => (e.currentTarget.style.background = c.rowHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = c.trayBtnBg)}
        >
          <TrayIcon color={c.textMuted} />
        </button>
        {trayOpen && (
          <QuickSwitchTray c={c} entries={entries} onSwitchIp={onSwitchIp} onClose={onCloseTray} />
        )}
      </div>
      <button
        onClick={onToggleTheme}
        title="Toggle theme"
        style={titleBarButtonStyle(c)}
        onMouseEnter={(e) => (e.currentTarget.style.background = c.rowHover)}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {isDark ? <SunIcon color={c.textMuted} /> : <MoonIcon color={c.textMuted} />}
      </button>
    </div>
  );
}

function titleBarButtonStyle(c: ColorTokens): CSSProperties {
  return {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "none",
    background: c.trayBtnBg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: c.textMuted,
  };
}
