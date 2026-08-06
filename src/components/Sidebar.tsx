import type { ReactNode } from "react";
import type { ColorTokens } from "../theme";
import { HistoryIcon, ListIcon } from "./icons";

export interface GroupSummary {
  name: string;
  count: number;
}

interface SidebarProps {
  c: ColorTokens;
  view: "list" | "history";
  onGoList: () => void;
  onGoHistory: () => void;
  entryCount: number;
  groups: GroupSummary[];
  groupFilter: string | null;
  onSelectGroup: (group: string) => void;
  helperActive: boolean;
  onRemoveHelper: () => void;
}

export function Sidebar({
  c,
  view,
  onGoList,
  onGoHistory,
  entryCount,
  groups,
  groupFilter,
  onSelectGroup,
  helperActive,
  onRemoveHelper,
}: SidebarProps) {
  return (
    <div
      style={{
        width: 200,
        flex: "none",
        background: c.sidebarBg,
        borderRight: `1px solid ${c.border}`,
        padding: "16px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
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
        Managed by Hosts Manager
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
          <span title={helperActive ? "Writes and DNS flushes happen without a password prompt." : "The next write will prompt once to install it."}>
            {helperActive ? "Background helper active" : "Background helper not installed"}
          </span>
          {helperActive && (
            <button
              onClick={onRemoveHelper}
              style={{
                marginLeft: "auto",
                fontSize: 11,
                fontWeight: 600,
                color: c.textMuted,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
                textDecoration: "underline",
              }}
            >
              Remove
            </button>
          )}
        </div>
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
