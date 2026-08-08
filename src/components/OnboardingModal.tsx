import { useState } from "react";
import type { ColorTokens } from "../theme";
import type { UnmanagedEntry } from "../types";

interface OnboardingModalProps {
  c: ColorTokens;
  entries: UnmanagedEntry[];
  onAdopt: (ids: string[]) => Promise<void>;
  onSkip: () => void;
}

function errorMessage(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "Something went wrong.";
}

export function OnboardingModal({ c, entries, onAdopt, onSkip }: OnboardingModalProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(entries.map((e) => e.id)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = selected.size === entries.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(entries.map((e) => e.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAdopt() {
    setError(null);
    setSubmitting(true);
    try {
      await onAdopt(Array.from(selected));
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: c.overlay, zIndex: 80, animation: "hm-fade-in .15s ease" }} onClick={submitting ? undefined : onSkip} />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 560,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          background: c.cardBg,
          borderRadius: 14,
          boxShadow: c.popShadow,
          zIndex: 81,
          animation: "hm-pop-in-centered .16s ease",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "22px 24px 4px", flex: "none" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: c.text }}>Welcome to Hosts Manager</div>
          <div style={{ fontSize: 12.5, color: c.textMuted, marginTop: 4, lineHeight: 1.5 }}>
            We found {entries.length} {entries.length === 1 ? "entry" : "entries"} already in your hosts file. Choose
            which ones to bring under management here.
          </div>
        </div>

        <div style={{ padding: "14px 24px 0", flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: c.text, cursor: "pointer" }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={submitting} />
            Select all
          </label>
          <div style={{ fontSize: 11.5, color: c.textFaint }}>{selected.size} selected</div>
        </div>

        <div className="hm-scroll" style={{ flex: 1, overflow: "auto", padding: "10px 24px", marginTop: 6 }}>
          <div style={{ borderRadius: 10, border: `1px solid ${c.border}` }}>
            {entries.map((entry, idx) => (
              <label
                key={entry.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr)",
                  gap: 12,
                  alignItems: "center",
                  padding: "10px 12px",
                  borderBottom: idx === entries.length - 1 ? "none" : `1px solid ${c.rowBorder}`,
                  cursor: submitting ? "default" : "pointer",
                }}
              >
                <input type="checkbox" checked={selected.has(entry.id)} onChange={() => toggleOne(entry.id)} disabled={submitting} />
                <span
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: c.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.hostname}
                </span>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 12,
                    color: c.textMuted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.ip}
                </span>
                <span style={{ fontSize: 12, color: c.textFaint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {entry.comment || "—"}
                </span>
              </label>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ padding: "12px 24px 0", flex: "none" }}>
            <div style={{ padding: "10px 12px", borderRadius: 8, background: c.redSoft, color: c.red, fontSize: 12.5 }}>{error}</div>
          </div>
        )}

        <div style={{ padding: "16px 24px 20px", display: "flex", gap: 10, flex: "none" }}>
          <button
            onClick={onSkip}
            disabled={submitting}
            style={{
              flex: 1,
              height: 38,
              borderRadius: 8,
              border: `1px solid ${c.border}`,
              background: "transparent",
              color: c.text,
              fontSize: 13,
              fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            Skip
          </button>
          <button
            onClick={handleAdopt}
            disabled={submitting || selected.size === 0}
            style={{
              flex: 1,
              height: 38,
              borderRadius: 8,
              border: "none",
              background: c.accent,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: submitting || selected.size === 0 ? "not-allowed" : "pointer",
              opacity: submitting || selected.size === 0 ? 0.6 : 1,
            }}
          >
            {submitting ? "Adopting…" : `Adopt ${selected.size} ${selected.size === 1 ? "entry" : "entries"}`}
          </button>
        </div>
      </div>
    </>
  );
}
