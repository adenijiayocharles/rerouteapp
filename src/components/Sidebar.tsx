import type { ReactNode } from "react";
import type { ColorTokens } from "../theme";
import { FileIcon, HistoryIcon, ListIcon } from "./icons";

export interface GroupSummary {
  name: string;
  count: number;
}

interface SidebarProps {
  c: ColorTokens;
  view: "list" | "history" | "raw";
  onGoList: () => void;
  onGoHistory: () => void;
  onGoRaw: () => void;
  entryCount: number;
  groups: GroupSummary[];
  groupFilter: string | null;
  onSelectGroup: (group: string) => void;
}

export function Sidebar({
  c,
  view,
  onGoList,
  onGoHistory,
  onGoRaw,
  entryCount,
  groups,
  groupFilter,
  onSelectGroup,
}: SidebarProps) {
  return (
    <div
      className="hm-scroll"
      style={{
        width: 200,
        flex: "none",
        background: c.sidebarBg,
        borderRight: `1px solid ${c.border}`,
        padding: "16px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        overflow: "auto",
        transition: "background .25s ease,border-color .25s ease",
      }}
    >
      <NavButton
        c={c}
        active={view === "list"}
        onClick={onGoList}
        icon={<ListIcon color={view === "list" ? c.accent : c.textMuted} />}
        label="Hosts"
        trailing={entryCount}
      />
      <NavButton
        c={c}
        active={view === "history"}
        onClick={onGoHistory}
        icon={<HistoryIcon color={view === "history" ? c.accent : c.textMuted} />}
        label="History"
      />
      <NavButton
        c={c}
        active={view === "raw"}
        onClick={onGoRaw}
        icon={<FileIcon color={view === "raw" ? c.accent : c.textMuted} />}
        label="Raw File"
      />

      {groups.length > 0 && (
        <>
          <div
            style={{
              marginTop: 14,
              padding: "0 10px 6px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".05em",
              textTransform: "uppercase",
              color: c.textFaint,
            }}
          >
            Groups
          </div>
          {groups.map((g) => {
            const active = groupFilter === g.name;
            return (
              <button
                key={g.name}
                onClick={() => onSelectGroup(g.name)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "7px 10px",
                  borderRadius: 8,
                  border: "none",
                  background: active ? c.accentSoft : "transparent",
                  color: active ? c.accent : c.textMuted,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", flex: "none" }} />
                {g.name}
                <span style={{ marginLeft: "auto", fontSize: 11, color: c.textFaint, fontWeight: 600 }}>
                  {g.count}
                </span>
              </button>
            );
          })}
        </>
      )}

      <div style={{ flex: 1 }} />
      <div style={{ padding: 10, fontSize: 11, color: c.textFaint, lineHeight: 1.5 }}>
        /etc/hosts
        <br />
        Managed by Reroute
      </div>
    </div>
  );
}

function NavButton({
  c,
  active,
  onClick,
  icon,
  label,
  trailing,
}: {
  c: ColorTokens;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  trailing?: number;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 8,
        border: "none",
        background: active ? c.accentSoft : "transparent",
        color: active ? c.accent : c.textMuted,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      {icon}
      {label}
      {trailing !== undefined && (
        <span style={{ marginLeft: "auto", fontSize: 11, color: c.textFaint, fontWeight: 600 }}>{trailing}</span>
      )}
    </button>
  );
}
