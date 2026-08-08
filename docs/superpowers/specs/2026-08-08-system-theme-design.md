# Add a "System" theme option

## Dark palette: make it truly dark

The current `darkColors` (`src/theme.ts`) are dark grays (`bg: #191a1e`, `cardBg: #212227`, etc.), not true dark. Revise the palette toward near-black, OLED-style surfaces while preserving the existing elevation hierarchy (bg/titlebar/sidebar → card → chip):

| token | old | new |
| --- | --- | --- |
| `pageBg` | `#0d0d10` | `#000000` |
| `bg` | `#191a1e` | `#000000` |
| `titlebar` | `#1d1e23` | `#0b0b0d` |
| `sidebarBg` | `#1d1e23` | `#0b0b0d` |
| `cardBg` | `#212227` | `#131315` |
| `inputBg` | `#212227` | `#111113` |
| `chipBg` | `#26272d` | `#1a1a1d` |
| `border` | `rgba(255,255,255,0.08)` | `rgba(255,255,255,0.10)` |
| `rowBorder` | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.07)` |
| `rowHover` | `rgba(255,255,255,0.045)` | `rgba(255,255,255,0.06)` |
| `scrollThumb` | `rgba(255,255,255,0.15)` | `rgba(255,255,255,0.18)` |
| `textFaint` | `#6c6c75` | `#87878f` |
| `overlay` | `rgba(0,0,0,0.6)` | `rgba(0,0,0,0.65)` |
| `windowShadow` | `...rgba(0,0,0,0.7)` | `...rgba(0,0,0,0.8)` |
| `popShadow` | `...rgba(0,0,0,0.55)` | `...rgba(0,0,0,0.6)` |

Border/hover/scrollbar opacities are bumped up slightly because the same alpha reads with less contrast against pure black than it did against the old dark-gray base. `textFaint` is lightened for the same reason — at the old value its contrast ratio against `#000000` drops to ~4:1, under AA for the small uppercase labels it's used on (`SectionLabel`, etc.). `text`, `textMuted`, `accent`, `green`, `red`, and their `*Soft` variants are unchanged — they already have sufficient contrast against black. Light theme (`lightColors`) is untouched.

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
