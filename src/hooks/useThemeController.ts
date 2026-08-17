import { useEffect, type Dispatch } from "react";
import { colorsFor, type Theme, type ThemePreference } from "../theme";
import type { Action } from "../state/appReducer";

const THEME_STORAGE_KEY = "reroute-theme";

export function loadStoredThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

export function systemPrefersDarkNow(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Persists the theme preference and keeps `systemPrefersDark` synced to
 * the OS setting, then resolves both into the actual palette to render. */
export function useThemeController(themePreference: ThemePreference, systemPrefersDark: boolean, dispatch: Dispatch<Action>) {
  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, themePreference);
  }, [themePreference]);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => dispatch({ type: "SET_SYSTEM_PREFERS_DARK", prefersDark: e.matches });
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [dispatch]);

  const theme: Theme = themePreference === "system" ? (systemPrefersDark ? "dark" : "light") : themePreference;
  const c = colorsFor(theme);

  return { theme, c };
}
