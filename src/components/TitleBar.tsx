import { useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ColorTokens } from "../theme";
import type { Entry } from "../types";
import { GearIcon, TrayIcon } from "./icons";
import { QuickSwitchTray } from "./QuickSwitchTray";

interface TitleBarProps {
  c: ColorTokens;
  trayOpen: boolean;
  onToggleTray: () => void;
  onCloseTray: () => void;
  entries: Entry[];
  onSwitchIp: (entryId: string, ipId: string) => void;
  onFlushDns: () => void;
  onOpenSettings: () => void;
}

const appWindow = getCurrentWindow();

type TrafficLightGlyph = "close" | "minimize" | "maximize";

function TrafficLightIcon({ glyph }: { glyph: TrafficLightGlyph }) {
  const stroke = "rgba(0,0,0,0.55)";
  if (glyph === "close") {
    return (
      <svg width="7" height="7" viewBox="0 0 7 7">
        <path d="M1 1 L6 6 M6 1 L1 6" stroke={stroke} strokeWidth={1.2} strokeLinecap="round" />
      </svg>
    );
  }
  if (glyph === "minimize") {
    return (
      <svg width="7" height="7" viewBox="0 0 7 7">
        <path d="M1 3.5 L6 3.5" stroke={stroke} strokeWidth={1.2} strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="7" height="7" viewBox="0 0 7 7">
      <path d="M1 4.5 L4.5 4.5 L4.5 1 M6 2.5 L2.5 2.5 L2.5 6" stroke={stroke} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrafficLight({
  color,
  onClick,
  label,
  glyph,
}: {
  color: string;
  onClick: () => void;
  label: string;
  glyph: TrafficLightGlyph;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={label}
      title={label}
      style={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: color,
        border: "none",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      {hovered && <TrafficLightIcon glyph={glyph} />}
    </button>
  );
}

export function TitleBar({
  c,
  trayOpen,
  onToggleTray,
  onCloseTray,
  entries,
  onSwitchIp,
  onFlushDns,
  onOpenSettings,
}: TitleBarProps) {
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
        <TrafficLight color="#ff5f57" label="Close" glyph="close" onClick={() => appWindow.close()} />
        <TrafficLight color="#febc2e" label="Minimize" glyph="minimize" onClick={() => appWindow.minimize()} />
        <TrafficLight color="#28c840" label="Maximize" glyph="maximize" onClick={() => appWindow.toggleMaximize()} />
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
        onClick={onOpenSettings}
        title="Settings"
        style={titleBarButtonStyle(c)}
        onMouseEnter={(e) => (e.currentTarget.style.background = c.rowHover)}
        onMouseLeave={(e) => (e.currentTarget.style.background = c.trayBtnBg)}
      >
        <GearIcon color={c.textMuted} />
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
