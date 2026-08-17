import type { ColorTokens } from "../theme";
import type { Entry } from "../types";
import { CloseIcon } from "./icons";

interface SwitchIpModalProps {
  c: ColorTokens;
  groupName: string;
  entries: Entry[];
  onCancel: () => void;
  onSwitchIp: (group: string, ip: string) => void;
}

interface IpOption {
  ip: string;
  count: number;
}

/** Every distinct IP address used across `entries`, each paired with how
 * many of those entries carry it — not every entry in the group necessarily
 * has every address, so picking one only switches the entries that do
 * (the rest are left untouched, see `switch_group_active_ip`). */
function distinctIps(entries: Entry[]): IpOption[] {
  const options: IpOption[] = [];
  for (const entry of entries) {
    for (const candidate of entry.ips) {
      const existing = options.find((o) => o.ip === candidate.ip);
      if (existing) {
        existing.count += 1;
      } else {
        options.push({ ip: candidate.ip, count: 1 });
      }
    }
  }
  return options.sort((a, b) => a.ip.localeCompare(b.ip));
}

export function SwitchIpModal({ c, groupName, entries, onCancel, onSwitchIp }: SwitchIpModalProps) {
  const options = distinctIps(entries);

  return (
    <>
      <div
        style={{ position: "absolute", inset: 0, background: c.overlay, zIndex: 70, animation: "hm-fade-in .15s ease" }}
        onClick={onCancel}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 380,
          background: c.cardBg,
          borderRadius: 14,
          boxShadow: c.popShadow,
          zIndex: 71,
          animation: "hm-pop-in-centered .16s ease",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "18px 20px 4px", gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: c.text }}>Switch IP</div>
            <div style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
              Applies to every matching entry in &#8220;{groupName}&#8221;
            </div>
          </div>
          <button
            onClick={onCancel}
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: "none",
              background: "transparent",
              color: c.textMuted,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <CloseIcon color={c.textMuted} />
          </button>
        </div>

        <div style={{ padding: "12px 20px 20px" }}>
          {options.length === 0 ? (
            <div style={{ fontSize: 12.5, color: c.textFaint, padding: "12px 0" }}>No IP addresses found in this group.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {options.map((opt) => (
                <button
                  key={opt.ip}
                  onClick={() => onSwitchIp(groupName, opt.ip)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: `1px solid ${c.border}`,
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = c.rowHover)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600, color: c.text }}>
                    {opt.ip}
                  </span>
                  <span style={{ fontSize: 11, color: c.textFaint }}>
                    {opt.count} of {entries.length} {entries.length === 1 ? "entry" : "entries"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
