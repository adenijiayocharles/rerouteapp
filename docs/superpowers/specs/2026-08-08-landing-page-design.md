# Reroute marketing landing page

## Problem

Reroute (formerly Hosts Manager) has a working app and a signed/notarized macOS release
pipeline, but no page to point anyone at. There's no way to show the product to someone
who isn't already looking at the source or a build artifact.

## Goal

A single-page marketing site for Reroute, built as a new Claude Design project, that
explains the product and drives a "Download for macOS" click. It should look like a
direct extension of the app itself — same accent color, same fonts, same flat/rounded
aesthetic — not a separate marketing brand.

## Content structure

One long-scroll page, sections top to bottom:

**Hero**
- Headline: "Reroute your hosts file. Without the fear."
- Subhead: "Swap a hostname between Local, Staging, and Prod with one click. See exactly
  what will change before it's written. Never lose a manual edit."
- Primary CTA button: "Download for macOS", linking to
  `https://github.com/adenijiayocharles/rerouteapp/releases`
- Small caption under the button: "Apple Silicon & Intel"
- A hero Mockup Window Card (see Visual system) showing the main hosts list with a couple
  of multi-IP entries, one active IP highlighted.

**Trust bar**
A row of small pill chips directly under the hero: "Signed & notarized" · "Runs in the
menu bar" · "Autostart on login" · "Light, dark, or system theme".

**Feature sections** (alternating image/copy, one `FeatureSection` block each, in this
order):

1. *Safe writes & diff preview*
   - Headline: "Every change, previewed before it's real."
   - Body: "Reroute never edits your hosts file blind. Every save shows you an exact
     diff first — add, remove, or flip an active IP, and confirm precisely what's about
     to change. Writes are atomic and timestamped, so a crash or power loss can never
     leave `/etc/hosts` half-written."
   - Mockup: the diff/confirm panel, red/green line diff, confirm button.

2. *Adopt existing entries*
   - Headline: "Reroute learns your setup — it doesn't fight it."
   - Body: "First launch scans your hosts file and finds entries you already added by
     hand. Pick which ones to bring under management — the rest stay exactly as they
     are, untouched."
   - Mockup: the onboarding modal, checklist of found entries with an "Adopt N entries"
     button.

3. *Raw editor with linting*
   - Headline: "A real text editor, not just a form."
   - Body: "Prefer editing hosts syntax directly? The raw view gives you a full text
     editor with inline linting — duplicate hostnames, invalid IPs, and shadow-domain
     conflicts are flagged as you type, before you ever hit save."
   - Mockup: code editor panel, monospace text, a couple of inline warning squiggles.

4. *History & rollback*
   - Headline: "Nothing is ever really gone."
   - Body: "Switched an IP by mistake? Deleted the wrong entry? Reroute keeps a full
     history of every write it makes, so you can roll back to any prior state in one
     click."
   - Mockup: the history list with timestamped entries and a "Restore" action.

**Closing CTA**
- Repeats the "Download for macOS" button.
- Small note beneath it: "Windows and Linux support is planned."

**Footer**
- Reroute wordmark.
- Link to the GitHub repo (`https://github.com/adenijiayocharles/rerouteapp`).
- "Free & open source."
- Copyright line.

## Visual system

Reused directly from the shipped app rather than invented fresh:

- **Accent color:** `#5b5fef` (light) / `#8285f7` (dark) — the app's single accent,
  from `src/theme.ts`. No second brand color.
- **Type:** Space Grotesk for headlines/body, JetBrains Mono for hostnames, IPs, and any
  code-like text inside mockups — same Google Fonts import as `index.html`.
- **Palette/surfaces:** page background, card background, borders, and text colors pulled
  from the same `lightColors`/`darkColors` token sets already in `src/theme.ts`, so the
  page can support light/dark via `prefers-color-scheme` the same way the app does.
- **Layout:** centered content column, ~1150px max width, generous vertical whitespace,
  soft rounded corners (12–16px), minimal/no borders, flat design — no heavy shadows
  except on the Mockup Window Card below.
- **Responsive:** single column under ~900px; `FeatureSection` blocks stack image above
  copy instead of side by side.

### Components

- **Mockup Window Card** — the recurring visual device tying the page back to the real
  app: a rounded card with three traffic-light dots and a thin titlebar reading
  "Reroute," inset content styled with the same color tokens as the live app UI. Used for
  the hero image and all four feature mockups. These are hand-built recreations of the
  real screens, not literal screenshots — see Dependencies below.
- **FeatureSection** — eyebrow label, headline, body copy, one Mockup Window Card,
  alternating left/right placement.
- **CTA button** — solid accent fill, rounded, no border, same visual weight as a
  primary action button in the app itself.
- **Trust bar chip** — small rounded pill, muted background, single line of text.

## Claude Design build plan

- New Claude Design project named "Reroute Landing Page", not added to the existing
  "Hosts Manager desktop app UI" project.
- `create_support_js` at the project root, then `Reroute.dc.html` as the page file —
  same convention as the existing app-UI project's `Hosts Manager.dc.html`.
- Load `get_claude_design_prompt` and the `hifi-design` skill (not `frontend-design`)
  before writing any files — this page aligns to an existing design system (the app's
  own theme), it isn't inventing a new one.
- After writing, use `render_preview` to screenshot the page and do a visual pass against
  this spec's Visual system section before calling the build done.

## Dependencies / open items

Not blockers for building the page, but true today and worth tracking:

- The download CTA points at the GitHub releases page, which currently only has **draft**
  releases (per `.github/workflows/release-macos.yml`'s `releaseDraft: true`). The
  button is inert until a real release is published.
- The footer's "Free & open source" claim requires adding a LICENSE file and keeping the
  `rerouteapp` repo public — neither exists yet as of this spec.
- The feature-section mockups are hand-built recreations, not real screenshots. If the
  app's UI changes materially, these can drift out of sync and would need a manual
  refresh — there's no automated link between the app's actual components and the
  marketing mockups.

## Out of scope

- No pricing page, docs, changelog, or blog — single scrolling page only.
- No email/waitlist capture — the only CTA is the download link.
- No Windows/Linux download links — mentioned as "planned" text only, no fake buttons.
- No analytics/tracking integration.
