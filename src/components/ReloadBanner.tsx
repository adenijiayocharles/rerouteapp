import type { ColorTokens } from "../theme";
import { WarningIcon } from "./icons";

interface ReloadBannerProps {
  c: ColorTokens;
  onReload: () => void;
  onDismiss: () => void;
}

export function ReloadBanner({ c, onReload, onDismiss }: ReloadBannerProps) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 20px",
        background: c.redSoft,
        borderBottom: `1px solid ${c.red}`,
        color: c.text,
        fontSize: 12.5,
      }}
    >
      <WarningIcon size={15} color={c.red} />
      <div style={{ flex: 1 }}>
        The hosts file changed outside re:route. Reload to see the latest version before making further
        changes.
      </div>
      <button
        onClick={onReload}
        style={{
          height: 28,
          padding: "0 12px",
          borderRadius: 7,
          border: "none",
          background: c.red,
          color: "#fff",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Reload
      </button>
      <button
        onClick={onDismiss}
        style={{
          height: 28,
          padding: "0 12px",
          borderRadius: 7,
          border: `1px solid ${c.border}`,
          background: "transparent",
          color: c.text,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
