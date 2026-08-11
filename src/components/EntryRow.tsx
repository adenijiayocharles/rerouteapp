import { memo, useEffect, useRef, useState } from "react";
import type { ColorTokens } from "../theme";
import type { Entry } from "../types";
import { CheckIcon, ChevronDownIcon, EditIcon, MoreVerticalIcon, Spinner, TrashIcon } from "./icons";

interface EntryRowProps {
  c: ColorTokens;
  entry: Entry;
  isDropdownOpen: boolean;
  isFlushing: boolean;
  disabled: boolean;
  onToggleDropdown: (entryId: string) => void;
  onToggleEnabled: (entryId: string) => void;
  onEdit: (entry: Entry) => void;
  onDelete: (entryId: string) => void;
  onSwitchIp: (entryId: string, ipId: string) => void;
}

const gridTemplate = "44px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 40px";

// Memoized so a re-render caused by unrelated state (typing in the search
// box, editing the raw file, etc.) doesn't re-render every row and
// re-subscribe every dropdown's document-level mousedown listener. Only
// effective because every prop here is reference-stable across those
// unrelated renders: `entry` comes straight from `state.entries` (the
// array is replaced wholesale on refresh, but unchanged entry objects
// inside it keep their identity), `c` is a module-level constant from
// `colorsFor`, and the callbacks are `useCallback`-wrapped in App.tsx.
export const EntryRow = memo(function EntryRow({
  c,
  entry,
  isDropdownOpen,
  isFlushing,
  disabled,
  onToggleDropdown,
  onToggleEnabled,
  onEdit,
  onDelete,
  onSwitchIp,
}: EntryRowProps) {
  const activeIp = entry.ips.find((i) => i.id === entry.activeIpId) ?? entry.ips[0];
  const ipMenuRef = useRef<HTMLDivElement>(null);
  const entryId = entry.id;

  useEffect(() => {
    if (!isDropdownOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (ipMenuRef.current && !ipMenuRef.current.contains(e.target as Node)) {
        onToggleDropdown(entryId);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isDropdownOpen, entryId, onToggleDropdown]);

  const [isMenuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isMenuOpen]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: gridTemplate,
        gap: 14,
        alignItems: "center",
        padding: "13px 14px",
        borderBottom: `1px solid ${c.rowBorder}`,
        opacity: entry.enabled ? 1 : 0.5,
        transition: "background .12s ease,opacity .2s ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = c.rowHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div>
        <button
          onClick={() => onToggleEnabled(entryId)}
          disabled={disabled}
          title="Enable / disable"
          style={{
            width: 34,
            height: 20,
            borderRadius: 10,
            border: "none",
            padding: 2,
            cursor: disabled ? "not-allowed" : "pointer",
            background: entry.enabled ? c.green : c.chipBg,
            display: "flex",
            alignItems: "center",
            transition: "background .15s ease",
          }}
        >
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 1px 2px rgba(0,0,0,.25)",
              transform: entry.enabled ? "translateX(14px)" : "translateX(0)",
              transition: "transform .15s ease",
            }}
          />
        </button>
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 13,
            fontWeight: 600,
            color: c.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.hostname}
        </div>
        {entry.group && (
          <div style={{ fontSize: 10.5, fontWeight: 600, color: c.textFaint, marginTop: 2 }}>{entry.group}</div>
        )}
      </div>

      <div style={{ position: "relative" }} ref={ipMenuRef}>
        <button
          onClick={() => onToggleDropdown(entryId)}
          disabled={disabled}
          title={activeIp?.label}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            padding: "6px 10px",
            borderRadius: 8,
            border: `1px solid ${c.border}`,
            background: c.chipBg,
            cursor: disabled ? "not-allowed" : "pointer",
            maxWidth: "100%",
            width: "100%",
          }}
        >
          {isFlushing ? (
            <Spinner size={8} color={c.accent} />
          ) : (
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: c.green, flex: "none" }} />
          )}
          <span
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 12.5,
              color: c.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {activeIp?.ip}
          </span>
          <ChevronDownIcon color={c.textFaint} />
        </button>
        {isDropdownOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              minWidth: 220,
              background: c.cardBg,
              border: `1px solid ${c.border}`,
              borderRadius: 10,
              boxShadow: c.popShadow,
              zIndex: 40,
              padding: 5,
              animation: "hm-pop-in .13s ease",
            }}
          >
            {entry.ips.map((ip) => {
              const active = ip.id === entry.activeIpId;
              return (
                <button
                  key={ip.id}
                  onClick={() => onSwitchIp(entryId, ip.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "8px 9px",
                    borderRadius: 7,
                    border: "none",
                    background: active ? c.accentSoft : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      flex: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: `1.5px solid ${active ? c.accent : c.textFaint}`,
                      background: active ? c.accent : "transparent",
                    }}
                  >
                    {active && <CheckIcon />}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: c.text }}>{ip.label}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: c.textMuted }}>
                      {ip.ip}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: c.textFaint, textAlign: "center" }}>{entry.lastModified}</div>
      <div style={{ position: "relative" }} ref={menuRef}>
        <button
          onClick={() => setMenuOpen((open) => !open)}
          disabled={disabled}
          title="More actions"
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            border: "none",
            background: isMenuOpen ? c.chipBg : "transparent",
            color: c.textFaint,
            cursor: disabled ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MoreVerticalIcon />
        </button>
        {isMenuOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              minWidth: 140,
              background: c.cardBg,
              border: `1px solid ${c.border}`,
              borderRadius: 10,
              boxShadow: c.popShadow,
              zIndex: 40,
              padding: 5,
              animation: "hm-pop-in .13s ease",
            }}
          >
            <button
              onClick={() => {
                setMenuOpen(false);
                onEdit(entry);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "8px 9px",
                borderRadius: 7,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 12.5,
                fontWeight: 600,
                color: c.text,
              }}
            >
              <EditIcon size={13} />
              Edit
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                onDelete(entryId);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "8px 9px",
                borderRadius: 7,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 12.5,
                fontWeight: 600,
                color: c.red,
              }}
            >
              <TrashIcon size={13} />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export { gridTemplate };
