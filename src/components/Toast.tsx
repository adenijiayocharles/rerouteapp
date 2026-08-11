import type { ColorTokens } from "../theme";
import type { ToastState } from "../types";
import { CloseIcon, ErrorIcon, Spinner, SuccessIcon, WarningIcon } from "./icons";

interface ToastProps {
  c: ColorTokens;
  toast: ToastState;
  onDismiss: () => void;
  onRetryFlush: () => void;
}

export function Toast({ c, toast, onDismiss, onRetryFlush }: ToastProps) {
  const iconBg = toast.type === "error" ? c.redSoft : toast.type === "warning" ? c.accentSoft : c.greenSoft;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 22,
        right: 22,
        width: 340,
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: 12,
        boxShadow: c.popShadow,
        zIndex: 80,
        padding: "14px 14px 14px 12px",
        display: "flex",
        gap: 11,
        animation: "hm-toast-in .18s ease",
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: iconBg,
          marginTop: 1,
        }}
      >
        {toast.type === "success" && <SuccessIcon color={c.green} />}
        {toast.type === "error" && <ErrorIcon color={c.red} />}
        {toast.type === "info" && <Spinner color={c.accent} />}
        {toast.type === "warning" && <WarningIcon size={14} color={c.accent} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: c.text }}>{toast.title}</div>
        <div style={{ fontSize: 12, color: c.textMuted, marginTop: 3, lineHeight: 1.4 }}>{toast.message}</div>
        {toast.retryFlush && (
          <button
            onClick={onRetryFlush}
            style={{
              marginTop: 8,
              fontSize: 12,
              fontWeight: 700,
              color: c.accent,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            Retry DNS flush
          </button>
        )}
        {toast.updateAction && (
          <button
            onClick={toast.updateAction.onClick}
            style={{
              marginTop: 8,
              fontSize: 12,
              fontWeight: 700,
              color: c.accent,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {toast.updateAction.label}
          </button>
        )}
      </div>
      <button
        onClick={onDismiss}
        style={{
          width: 20,
          height: 20,
          flex: "none",
          borderRadius: 5,
          border: "none",
          background: "transparent",
          color: c.textFaint,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CloseIcon size={11} strokeWidth={2.5} />
      </button>
    </div>
  );
}
