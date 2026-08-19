import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ColorTokens } from "../theme";
import { EditIcon, FileIcon, HistoryIcon, ListIcon, StarIcon } from "./icons";

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
  onRenameGroup: (oldName: string, newName: string) => void;
  favoritesCount: number;
  favoritesFilter: boolean;
  onSelectFavorites: () => void;
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
  onRenameGroup,
  favoritesCount,
  favoritesFilter,
  onSelectFavorites,
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
        active={view === "list" && !groupFilter && !favoritesFilter}
        onClick={onGoList}
        icon={<ListIcon color={view === "list" && !groupFilter && !favoritesFilter ? c.accent : c.textMuted} />}
        label="Hosts"
        trailing={entryCount}
      />
      {favoritesCount > 0 && (
        <NavButton
          c={c}
          active={view === "list" && favoritesFilter}
          onClick={onSelectFavorites}
          icon={<StarIcon color={view === "list" && favoritesFilter ? c.accent : c.textMuted} filled={view === "list" && favoritesFilter} />}
          label="Favourites"
          trailing={favoritesCount}
        />
      )}
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
          {groups.map((g) => (
            <GroupRow
              key={g.name}
              c={c}
              group={g}
              active={view === "list" && groupFilter === g.name}
              onSelect={() => onSelectGroup(g.name)}
              onRename={(newName) => onRenameGroup(g.name, newName)}
            />
          ))}
        </>
      )}

      <div style={{ flex: 1 }} />
      <div style={{ padding: 10, fontSize: 11, color: c.textFaint, lineHeight: 1.5 }}>
        /etc/hosts
        <br />
        Managed by re:route
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

function GroupRow({
  c,
  group,
  active,
  onSelect,
  onRename,
}: {
  c: ColorTokens;
  group: GroupSummary;
  active: boolean;
  onSelect: () => void;
  onRename: (newName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(group.name);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Pick up a rename that landed from elsewhere (or a revert after a failed
  // save) while this row wasn't mid-edit.
  useEffect(() => {
    if (!editing) setValue(group.name);
  }, [group.name, editing]);

  function commit() {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== group.name) {
      onRename(trimmed);
    } else {
      setValue(group.name);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        borderRadius: 8,
        background: active && !editing ? c.accentSoft : "transparent",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {editing ? (
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 8px", flex: 1, minWidth: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.accent, flex: "none" }} />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            autoComplete="off"
            autoCapitalize="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
                setValue(group.name);
              }
            }}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: "inherit",
              color: c.text,
              background: c.cardBg,
              border: `1px solid ${c.accent}`,
              borderRadius: 6,
              padding: "3px 6px",
              outline: "none",
            }}
          />
        </div>
      ) : (
        <button
          onClick={onSelect}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "7px 10px",
            borderRadius: 8,
            border: "none",
            background: "transparent",
            color: active ? c.accent : c.textMuted,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
            textAlign: "left",
            flex: 1,
            minWidth: 0,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", flex: "none" }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.name}</span>
        </button>
      )}

      <div style={{ width: 28, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {editing ? null : hovered ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            title="Rename group"
            style={{
              width: 20,
              height: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              borderRadius: 5,
              background: "transparent",
              color: c.textMuted,
              cursor: "pointer",
            }}
          >
            <EditIcon size={11} />
          </button>
        ) : (
          <span style={{ fontSize: 11, color: c.textFaint, fontWeight: 600 }}>{group.count}</span>
        )}
      </div>
    </div>
  );
}
