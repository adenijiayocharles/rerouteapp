# Add a "System" theme option

## Problem

Settings currently offers only two theme choices, Light and Dark (`SettingsModal.tsx`), backed by a single stored value `theme: "light" | "dark"` (`src/theme.ts`, `App.tsx`). There is no way to have the app automatically follow the OS's light/dark appearance.

## Goal

Add a third "System" option to the theme picker in Settings. When selected, the app's resolved theme tracks `prefers-color-scheme` live, including while the app is open and the user changes their OS appearance setting.

## Data model

Split the existing single `theme` concept into two:

- `Theme = "light" | "dark"` (`src/theme.ts`, unchanged) — the *resolved* value. `colorsFor(theme)` and every component that receives `theme`/`c` continue to work exactly as today; no downstream component changes required.
- `ThemePreference = Theme | "system"` (new type, `src/theme.ts`) — what's persisted and shown in Settings.

`App.tsx` state changes:

- Replace `theme: Theme` with `themePreference: ThemePreference`.
- Add `systemPrefersDark: boolean`, initialized from `window.matchMedia("(prefers-color-scheme: dark)").matches` and kept live via a `change` listener registered in a `useEffect` on mount (cleaned up on unmount).
- Add a derived (not stored) `theme: Theme` computed each render: `themePreference === "system" ? (systemPrefersDark ? "dark" : "light") : themePreference`. This is the value passed to `colorsFor` and down to every component exactly as `state.theme` is today.

## Persistence

- `THEME_STORAGE_KEY` (`"hosts-manager-theme"`) now stores a `ThemePreference` (`"light" | "dark" | "system"`) instead of just `Theme`.
- `loadStoredTheme()` → rename to `loadStoredThemePreference()`, validates the stored string against all three values; returns `"system"` if the stored value is missing/invalid (i.e. fresh installs default to System). Existing installs with `"light"` or `"dark"` already stored are read as-is — no migration step needed, both remain valid `ThemePreference` values.

## Settings UI (`SettingsModal.tsx`)

Add a third `ThemeOption` pill, "System", after the existing Light/Dark pills:

```
[Light] [Dark] [System]
```

- New icon `MonitorIcon` in `icons.tsx`, matching the existing feather-style stroke icons (same pattern as `SunIcon`/`MoonIcon`): a simple rounded rect (screen) with a small stand/base line beneath it.
- `SettingsModalProps.theme: Theme` → `themePreference: ThemePreference`; `active` check on each pill compares against `themePreference` (not the resolved `theme`).
- `onSetTheme: (theme: Theme) => void` → `onSetThemePreference: (pref: ThemePreference) => void`.

## Title bar quick toggle (`TitleBar.tsx`)

The sun/moon button in the title bar keeps its current look and position, but its behavior changes slightly now that a third state exists:

- `isDark` continues to reflect the *resolved* `theme` (so the icon always shows what's currently rendered, including when driven by System).
- Clicking it no longer flips a raw two-value theme; it sets an **explicit** preference — `SET_THEME_PREFERENCE` with the opposite of the currently-resolved theme (e.g. if System is currently resolving to dark, clicking sets preference to `"light"`). This pins the user to an explicit choice and exits System mode, matching how most apps' quick-toggle buttons behave. System can only be re-selected via Settings.

## Reducer changes (`App.tsx`)

- `SET_THEME` action → `SET_THEME_PREFERENCE`, payload `{ preference: ThemePreference }`, sets `state.themePreference` directly.
- `TOGGLE_THEME` action: unchanged name/call sites, but new behavior — computes the current resolved theme (same derivation as the render-time `theme` value) and dispatches the opposite as an explicit `themePreference`, per the Title Bar section above.
- New `SET_SYSTEM_PREFERS_DARK` action, `{ prefersDark: boolean }`, sets `state.systemPrefersDark`. Dispatched only from the `matchMedia` listener effect.
- The `localStorage.setItem(THEME_STORAGE_KEY, ...)` effect keys off `state.themePreference` instead of `state.theme`.

## Out of scope

- No per-OS-platform special-casing (Tauri's webview forwards `prefers-color-scheme` correctly on macOS via WebKit; Windows/Linux behavior is inherited from the same web API and not separately verified here).
- No animation/transition changes when the resolved theme changes due to a live OS switch — it uses whatever transition (if any) already exists for theme changes today.
- No changes to any component that only consumes resolved `ColorTokens`/`theme` — this is confined to `App.tsx`, `SettingsModal.tsx`, `TitleBar.tsx`, `theme.ts`, and `icons.tsx`.
