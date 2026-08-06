import type { ColorTokens } from "../theme";
import type { Entry } from "../types";
import { EntryRow, gridTemplate } from "./EntryRow";
import { PlusIcon, SearchIcon } from "./icons";

interface ListViewProps {
  c: ColorTokens;
  entries: Entry[];
  totalEntryCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  onAddClick: () => void;
  groupFilter: string | null;
  onClearGroupFilter: () => void;
  openIpMenuId: string | null;
  flushingId: string | null;
  disabled: boolean;
  onToggleDropdown: (entryId: string) => void;
  onToggleEnabled: (entryId: string) => void;
  onEdit: (entry: Entry) => void;
  onSwitchIp: (entryId: string, ipId: string) => void;
}

export function ListView({
  c,
  entries,
  totalEntryCount,
  search,
  onSearchChange,
  onAddClick,
  groupFilter,
  onClearGroupFilter,
  openIpMenuId,
  flushingId,
  disabled,
  onToggleDropdown,
  onToggleEnabled,
  onEdit,
  onSwitchIp,
}: ListViewProps) {
  const subtitle = groupFilter ? `${groupFilter} · ${entries.length} entries` : `${totalEntryCount} managed entries`;

  return (
    <div className="hm-scroll" style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "24px 28px 16px",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flex: "none",
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: c.text, letterSpacing: "-0.01em" }}>Hosts</div>
          <div style={{ fontSize: 12.5, color: c.textMuted, marginTop: 2, display: "flex", alignItems: "center", gap: 8 }}>
            {subtitle}
            {groupFilter && (
              <button
                onClick={onClearGroupFilter}
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: c.accent,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Clear filter
              </button>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <span style={{ position: "absolute", left: 11, display: "flex", pointerEvents: "none" }}>
              <SearchIcon color={c.textFaint} />
            </span>
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search hosts…"
              style={{
                width: 220,
                height: 34,
                padding: "0 12px 0 32px",
                borderRadius: 8,
                border: `1px solid ${c.border}`,
                background: c.inputBg,
                color: c.text,
                fontSize: 13,
                outline: "none",
              }}
            />
          </div>
          <button
            onClick={onAddClick}
            disabled={disabled}
            style={{
              height: 34,
              padding: "0 14px",
              borderRadius: 8,
              border: "none",
              background: c.accent,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: disabled ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <PlusIcon />
            Add Entry
          </button>
        </div>
      </div>

      <div style={{ padding: "0 28px 4px", flex: "none" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: gridTemplate,
            gap: 14,
            padding: "8px 14px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".05em",
            textTransform: "uppercase",
            color: c.textFaint,
          }}
        >
          <div />
          <div>Hostname</div>
          <div>Active IP</div>
          <div>Comment</div>
          <div>Modified</div>
          <div />
        </div>
      </div>

      <div style={{ padding: "0 28px 28px", flex: 1 }}>
        <div style={{ borderRadius: 12, border: `1px solid ${c.border}`, overflow: "visible", background: c.cardBg }}>
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              c={c}
              entry={entry}
              isDropdownOpen={openIpMenuId === entry.id}
              isFlushing={flushingId === entry.id}
              disabled={disabled}
              onToggleDropdown={() => onToggleDropdown(entry.id)}
              onToggleEnabled={() => onToggleEnabled(entry.id)}
              onEdit={() => onEdit(entry)}
              onSwitchIp={(ipId) => onSwitchIp(entry.id, ipId)}
            />
          ))}
          {entries.length === 0 && (
            <div style={{ padding: "48px 20px", textAlign: "center", color: c.textFaint, fontSize: 13 }}>
              {search ? `No entries match "${search}"` : "No entries yet — add your first host."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
