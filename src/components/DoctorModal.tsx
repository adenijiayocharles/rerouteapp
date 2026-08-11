import { useEffect, useState } from "react";
import type { ColorTokens } from "../theme";
import type { DoctorCheck, DoctorStatus } from "../types";
import { CloseIcon, ErrorIcon, PulseIcon, Spinner, SuccessIcon, WarningIcon } from "./icons";

interface DoctorModalProps {
  c: ColorTokens;
  onClose: () => void;
  runDiagnostics: () => Promise<DoctorCheck[]>;
}

export function DoctorModal({ c, onClose, runDiagnostics }: DoctorModalProps) {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    runDiagnostics().then((result) => {
      if (!cancelled) {
        setChecks(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCopyReport() {
    if (!checks) return;
    const report = checks
      .map((check) => `[${check.status.toUpperCase()}] ${check.label} — ${check.detail}`)
      .join("\n");
    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <>
      <div
        style={{ position: "absolute", inset: 0, background: c.overlay, zIndex: 70, animation: "hm-fade-in .15s ease" }}
        onClick={onClose}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 520,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          background: c.cardBg,
          borderRadius: 14,
          boxShadow: c.popShadow,
          zIndex: 71,
          animation: "hm-pop-in-centered .16s ease",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <PulseIcon size={16} color={c.text} />
            <div style={{ fontSize: 15, fontWeight: 700, color: c.text }}>Doctor</div>
          </div>
          <button
            onClick={onClose}
            style={{ width: 26, height: 26, borderRadius: 7, border: "none", background: "transparent", color: c.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <CloseIcon color={c.textMuted} />
          </button>
        </div>

        <div style={{ fontSize: 12.5, color: c.textMuted, padding: "6px 20px 0" }}>
          A quick health check of the hosts file, helper daemon, and local storage.
        </div>

        <div className="hm-scroll" style={{ padding: "14px 20px 20px", overflow: "auto" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "24px 0", justifyContent: "center" }}>
              <Spinner size={14} color={c.accent} />
              <span style={{ fontSize: 12.5, color: c.textMuted }}>Running checks…</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {checks?.map((check) => <CheckRow key={check.id} c={c} check={check} />)}
            </div>
          )}
        </div>

        {!loading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 8,
              padding: "12px 20px",
              borderTop: `1px solid ${c.border}`,
            }}
          >
            <button
              onClick={handleCopyReport}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 7,
                border: `1px solid ${c.border}`,
                background: "transparent",
                color: c.text,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {copied ? "Copied" : "Copy Report"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function CheckRow({ c, check }: { c: ColorTokens; check: DoctorCheck }) {
  const { bg, icon } = statusVisual(c, check.status);
  return (
    <div style={{ display: "flex", gap: 11 }}>
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: bg,
          marginTop: 1,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: c.text }}>{check.label}</div>
        <div style={{ fontSize: 12, color: c.textMuted, marginTop: 3, lineHeight: 1.4 }}>{check.detail}</div>
      </div>
    </div>
  );
}

function statusVisual(c: ColorTokens, status: DoctorStatus) {
  if (status === "ok") {
    return { bg: c.greenSoft, icon: <SuccessIcon color={c.green} /> };
  }
  if (status === "fail") {
    return { bg: c.redSoft, icon: <ErrorIcon color={c.red} /> };
  }
  return { bg: c.accentSoft, icon: <WarningIcon size={14} color={c.accent} /> };
}
