// Ported verbatim from the imported design's lightColors()/darkColors().
export interface ColorTokens {
  pageBg: string;
  bg: string;
  titlebar: string;
  sidebarBg: string;
  border: string;
  rowBorder: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  green: string;
  greenSoft: string;
  red: string;
  redSoft: string;
  rowHover: string;
  chipBg: string;
  inputBg: string;
  overlay: string;
  cardBg: string;
  trayBtnBg: string;
  scrollThumb: string;
  windowShadow: string;
  popShadow: string;
}

export const lightColors: ColorTokens = {
  pageBg: "#e8e8ec",
  bg: "#ffffff",
  titlebar: "#fafafa",
  sidebarBg: "#fafafa",
  border: "rgba(15,15,20,0.09)",
  rowBorder: "rgba(15,15,20,0.06)",
  text: "#18181b",
  textMuted: "#71717a",
  textFaint: "#a1a1aa",
  accent: "#5b5fef",
  accentSoft: "rgba(91,95,239,0.1)",
  green: "#16a34a",
  greenSoft: "rgba(22,163,74,0.12)",
  red: "#e11d48",
  redSoft: "rgba(225,29,72,0.1)",
  rowHover: "rgba(15,15,20,0.035)",
  chipBg: "#f4f4f6",
  inputBg: "#f9f9fb",
  overlay: "rgba(15,15,20,0.35)",
  cardBg: "#ffffff",
  trayBtnBg: "transparent",
  scrollThumb: "rgba(0,0,0,0.15)",
  windowShadow: "0 30px 80px -20px rgba(0,0,0,0.35)",
  popShadow: "0 16px 40px -8px rgba(0,0,0,0.18)",
};

export const darkColors: ColorTokens = {
  pageBg: "#000000",
  bg: "#000000",
  titlebar: "#0b0b0d",
  sidebarBg: "#0b0b0d",
  border: "rgba(255,255,255,0.10)",
  rowBorder: "rgba(255,255,255,0.07)",
  text: "#f4f4f5",
  textMuted: "#a1a1aa",
  textFaint: "#87878f",
  accent: "#8285f7",
  accentSoft: "rgba(130,133,247,0.18)",
  green: "#34d399",
  greenSoft: "rgba(52,211,153,0.14)",
  red: "#fb7185",
  redSoft: "rgba(251,113,133,0.14)",
  rowHover: "rgba(255,255,255,0.06)",
  chipBg: "#1a1a1d",
  inputBg: "#111113",
  overlay: "rgba(0,0,0,0.65)",
  cardBg: "#131315",
  trayBtnBg: "transparent",
  scrollThumb: "rgba(255,255,255,0.18)",
  windowShadow: "0 30px 80px -20px rgba(0,0,0,0.8)",
  popShadow: "0 16px 40px -8px rgba(0,0,0,0.6)",
};

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

export function colorsFor(theme: Theme): ColorTokens {
  return theme === "light" ? lightColors : darkColors;
}
