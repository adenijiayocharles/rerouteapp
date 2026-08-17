import { useState } from "react";
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
 * (the rest are left untouched, see `switch_group_active_ip`). Counts by
 * unique entry, not by candidate row, so an entry with two candidates that
 * happen to share an address (not rejected by draft validation) isn't
 * counted twice for that one entry. */
function distinctIps(entries: Entry[]): IpOption[] {
  const countByIp = new Map<string, number>();
  for (const entry of entries) {
    const ipsInEntry = new Set(entry.ips.map((candidate) => candidate.ip));
    for (const ip of ipsInEntry) {
      countByIp.set(ip, (countByIp.get(ip) ?? 0) + 1);
    }
  }
  return Array.from(countByIp, ([ip, count]) => ({ ip, count })).sort((a, b) => a.ip.localeCompare(b.ip));
}

export function SwitchIpModal({ c, groupName, entries, onCancel, onSwitchIp }: SwitchIpModalProps) {
  const options = distinctIps(entries);
  // Guards against a double-click (or clicking two different IP rows in
  // quick succession) firing two concurrent switch_group_active_ip calls —
  // the parent closes this modal on selection, but that's a dispatch, not
  // an immediate unmount, so there's a window where a second click can
  // still land.
  const [submitting, setSubmitting] = useState(false);

  function handleSelect(ip: string) {
    if (submitting) return;
    setSubmitting(true);
    onSwitchIp(groupName, ip);
  }

  return (
    <>
      <div
        style={{ position: "absolute", inset: 0, background: c.overlay, zIndex: 70, animation: "hm-fade-in .15s ease" }}
        onClick={submitting ? undefined : onCancel}
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
            disabled={submitting}
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: "none",
              background: "transparent",
              color: c.textMuted,
              cursor: submitting ? "not-allowed" : "pointer",
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
                  onClick={() => handleSelect(opt.ip)}
                  disabled={submitting}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: `1px solid ${c.border}`,
                    background: "transparent",
                    cursor: submitting ? "not-allowed" : "pointer",
                    opacity: submitting ? 0.6 : 1,
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = submitting ? "transparent" : c.rowHover)}
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
