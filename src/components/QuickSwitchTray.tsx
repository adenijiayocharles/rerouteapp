import type { ColorTokens } from "../theme";
import type { Entry } from "../types";

interface QuickSwitchTrayProps {
  c: ColorTokens;
  entries: Entry[];
  onSwitchIp: (entryId: string, ipId: string) => void;
  onClose: () => void;
}

export function QuickSwitchTray({ c, entries, onSwitchIp, onClose }: QuickSwitchTrayProps) {
  const rows = entries.filter((e) => e.enabled).slice(0, 4);

  return (
    <div
      style={{
        position: "fixed",
        top: 56,
        right: 16,
        width: 320,
        background: c.cardBg,
        borderRadius: 12,
        boxShadow: c.popShadow,
        border: `1px solid ${c.border}`,
        zIndex: 60,
        animation: "hm-pop-in .16s ease",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${c.border}` }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: ".04em",
            color: c.textMuted,
            textTransform: "uppercase",
          }}
        >
          Quick Switch
        </div>
      </div>
      <div style={{ maxHeight: 320, overflow: "auto", padding: 6 }}>
        {rows.map((row) => {
          const activeIp = row.ips.find((i) => i.id === row.activeIpId) ?? row.ips[0];
          return (
            <div
              key={row.id}
              style={{ padding: "10px 10px 8px", borderRadius: 9 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = c.rowHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 7,
                }}
              >
                <div
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: c.text,
                  }}
                >
                  {row.hostname}
                </div>
                <div style={{ fontSize: 10.5, color: c.textFaint }}>{activeIp?.label}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {row.ips.map((ip) => {
                  const active = ip.id === row.activeIpId;
                  return (
                    <button
                      key={ip.id}
                      onClick={() => onSwitchIp(row.id, ip.id)}
                      style={{
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: 11,
                        padding: "5px 9px",
                        borderRadius: 7,
                        border: `1px solid ${active ? c.accent : c.border}`,
                        background: active ? c.accent : c.chipBg,
                        color: active ? "#fff" : c.textMuted,
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {ip.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div style={{ padding: "24px 12px", textAlign: "center", color: c.textFaint, fontSize: 12.5 }}>
            No enabled entries yet
          </div>
        )}
      </div>
      <div style={{ padding: "9px 14px", borderTop: `1px solid ${c.border}` }}>
        <button
          onClick={onClose}
          style={{
            width: "100%",
            textAlign: "center",
            background: "transparent",
            border: "none",
            color: c.textMuted,
            fontSize: 12,
            cursor: "pointer",
            padding: 4,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
