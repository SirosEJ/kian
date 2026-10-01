# Sepenta brand tokens for Kian (proposal)

Status: **proposed, awaiting design approval** (SFT-244, epic SFT-242). Nothing in the app uses these tokens yet; SFT-245 wires them into the build.

Machine-readable source: [`apps/web/src/theme/tokens.json`](../../apps/web/src/theme/tokens.json), checked by `apps/web/src/theme/tokens.test.ts` (resolves every token and fails if any listed contrast pair drops below its target).

A visual preview generated from the token file is in [`brand-preview.html`](brand-preview.html) (open it in a browser from the repo's `docs/design` folder).

## How the tokens reach the app

`apps/web/src/theme/tokens.json` is the single source. A small Vite plugin in `apps/web/vite.config.ts` turns it into CSS custom properties on `:root` (generator: `apps/web/src/theme/css.ts`) and serves them as `virtual:kian-theme.css`, which `apps/web/src/main.tsx` imports before `style.css`. Edit the JSON and every build, and the dev server, picks it up. Do not hand-edit generated CSS.

Variable names: palette `--palette-navy-900`; semantic roles `--bg-page`, `--bg-surface`, `--text-body`, `--text-link`, `--border-input`, `--action-primary-bg`, `--action-primary-text`, `--state-recording`, `--status-success-bg`, and so on (the path in the token file joined with `-`); type `--font-sans`, `--font-serif`, `--font-size-base`, `--line-height-normal`; shape `--radius-md`, `--shadow-raised`, `--space-4`. In CSS use `color: var(--text-body)`; in inline styles use `cssVar('text-body')` from `apps/web/src/theme`. Dark theme variables are not emitted until the dark theme is approved (`buildThemeCss(tokens, { includeDark: true })` produces them under `:root[data-theme="dark"]`).

## Components, fonts and the stylesheet (SFT-246)

- `apps/web/src/style.css` is written entirely with the token variables and contains no raw colour values (a test enforces this, and that every variable it uses exists in the token build). To change how something looks, change the token, not the stylesheet.
- Components in `apps/web/src/components/`: `Logo` (variants `light` and `dark`, minimum width 160px), `Button` (`primary`, `secondary`, `destructive`, `ghost`), `Alert` (`success`, `warning`, `error`, `info`), `Card`. A plain `<button>` also gets the primary style, and `role="alert"` / `role="status"` paragraphs get the error / info look.
- Fonts are self-hosted from npm (`@fontsource-variable/inter` and `@fontsource-variable/fraunces`), so the app makes no request to Google Fonts. The browser downloads only the character sets a page needs.
- Open the app with `?components` (for example `https://kian-staging-1088794188480.europe-west1.run.app/?components`) to see the gallery: logo on light and navy, palette, type, buttons, form controls and messages. It needs no sign-in and shows no data.
- The logo files used by the app are copies in `apps/web/src/assets/logo/` of the variants in `docs/design/`. Replace both when the design team supplies the SVG master.

The remaining screens are moved onto these components in SFT-250 (layout) and SFT-247.

## Where the values come from

- The Sepenta website (sepenta.io) defines its brand colours as CSS variables; read on 1 Oct 2026: navy `#07132F`, navy-2 `#0F1D42`, cyan `#01B6DF`, cyan text `#017A96`, blue `#3D63F5`. Body text `#1B2333`, muted `#5B6B85`, light surface `#F1F6F9`, border `#D7DEE9`, amber `#E8B04B`, error `#B23B3B`.
- The supplied logo uses the same navy and cyan (sampled from the image).
- Typography on the site: Inter for text, Fraunces (serif, weight 600) for headings. Buttons: cyan fill with navy text, 8 to 9px radius, bold. Cards: 12px radius with a soft navy shadow.
- Entries marked **derived** below are my proposals (tints, hover states, input border, success green, dark theme); they are not on the site.

## Core palette

| Token | Value | Origin | Usage |
| --- | --- | --- | --- |
| `navy-900` | #07132F | site --navy; logo navy | Headings, dark surfaces, secondary buttons |
| `navy-800` | #0F1D42 | site --navy-2 | Raised dark surfaces, hover on navy |
| `cyan-500` | #01B6DF | site --cyan; logo cyan | Primary action fill, accents, logo. Never text on white (2.4:1) |
| `cyan-400` | #33C6E8 | derived | Primary action hover |
| `cyan-700` | #017A96 | site --cyan-text | Links and cyan text on light backgrounds |
| `cyan-100` | #EAF8FC | derived | Info tint |
| `blue-500` | #3D63F5 | site --blue | Keyboard focus ring |
| `ink-800` | #1B2333 | site body text | Body text |
| `slate-500` | #5B6B85 | site muted text | Secondary text |
| `slate-400` | #7C8DA8 | derived | Input and control borders (3:1) |
| `slate-200` | #D7DEE9 | site border | Decorative dividers and card borders |
| `mist-100` | #F1F6F9 | site light section | Page background |
| `white` | #FFFFFF | site | Cards, inputs |
| `sky-200` | #C9D6EA | site | Secondary text on navy |
| `sky-300` | #9DB1CE | site | Muted text on navy |
| `amber-500` | #E8B04B | site | Highlight accents |
| `amber-100` | #FFF4DC | derived | Warning tint |
| `amber-800` | #8A5A00 | derived | Warning text |
| `red-600` | #DC2626 | site (rgb 220,38,38) | Destructive actions, recording state |
| `red-700` | #B23B3B | site | Error text |
| `red-100` | #FBEAEA | derived | Error tint |
| `green-700` | #176B3F | derived | Success text |
| `green-100` | #E7F5EE | derived | Success tint |
| `cyan-300` | #4FD0F0 | derived | Links on navy (dark theme) |
| `navy-700` | #2A3A63 | derived | Borders on navy (dark theme) |
| `navy-950` | #0B1A3C | derived | Raised surface on navy (dark theme) |
| `ice-100` | #E4ECF7 | site | Body text on navy |

## Semantic roles (light theme, the default)

| Role | Token |
| --- | --- |
| Page background | `mist-100` `#F1F6F9` |
| Cards, inputs | `white` |
| Dark surfaces (e.g. sidebar, if chosen) | `navy-900` |
| Headings | `navy-900` (Fraunces 600) |
| Body text | `ink-800` |
| Secondary text | `slate-500` |
| Links | `cyan-700` |
| Primary button | fill `cyan-500`, text `navy-900`, hover `cyan-400` |
| Secondary button | fill `navy-900`, text white, hover `navy-800` |
| Destructive button | fill `red-600`, text white |
| Input and control borders | `slate-400` |
| Dividers and card borders | `slate-200` |
| Keyboard focus ring | `blue-500`, 2px with offset |
| Recording indicator | `red-600` |
| Status messages | success `green-700` on `green-100`; warning `amber-800` on `amber-100`; error `red-700` on `red-100`; info `cyan-700` on `cyan-100` |

Dark theme values are included in the token file as an **optional** proposal so a decision can be made; they are not needed for the first release.

## Rules that follow from the contrast checks

1. **Never put white text on brand cyan.** It is 2.4:1. Primary buttons use navy text, as on the website.
2. **Never use brand cyan as text or as the only boundary on white.** Use `cyan-700` for links and cyan text.
3. **Input and control borders must be `slate-400`**, not the current `#BDC8D5` (1.7:1, below the 3:1 needed for form boundaries). `slate-200` is for decoration only.
4. **Never convey state by colour alone.** Errors and statuses also carry text or an icon.
5. Focus must be visible on every interactive element.

## Typography, shape and spacing

Sizes (rem): xs 0.8125, sm 0.875, base 1, lg 1.125, xl 1.5, 2xl 2, 3xl 2.5. Line height 1.2 for headings, 1.5 for text. Radius: 8 (controls), 12 (cards), 16 (large panels), pill. Shadows: `soft` for cards, `raised` (the website's) for menus and dialogs. Spacing scale on a 4px base.

Fonts are not loaded yet. Recommendation for SFT-245: self-host Inter and Fraunces (npm font packages bundled by Vite) rather than loading them from Google, to avoid a third-party request per visit.

## Logo

Supplied: `docs/design/sepenta-logo-supplied.png` (raster, off-white background).

| Variant | File | Use | Status |
| --- | --- | --- | --- |
| Light backgrounds | `docs/design/sepenta-logo-light-bg.png` | White and light surfaces, top bar | Derived: background removed, edges smoothed |
| Dark backgrounds | `docs/design/sepenta-logo-dark-bg.png` | Navy surfaces | Derived: navy letters recoloured white, cyan unchanged |

Proposed usage rules: minimum width 160px; the tagline "Powering Intelligent Growth" becomes unreadable below about 260px, so show the logo there only if a tagline-free version exists; clear space of at least half the height of the letter S on all sides; do not recolour, stretch, rotate, add effects or place on low-contrast backgrounds.

## Contrast targets and results

Target: WCAG 2.2 AA (4.5:1 for normal text; 3:1 for large text, icons, input borders and focus indicators). Ratios below are computed from the token file and enforced by its test.

| Role | Foreground | Background | Ratio | Target |
| --- | --- | --- | --- | --- |
| body on cards | `light.text.body` #1B2333 | `light.bg.surface` #FFFFFF | 15.73:1 | 4.5:1 |
| body on page | `light.text.body` #1B2333 | `light.bg.page` #F1F6F9 | 14.45:1 | 4.5:1 |
| headings | `light.text.heading` #07132F | `light.bg.surface` #FFFFFF | 18.37:1 | 4.5:1 |
| headings on page | `light.text.heading` #07132F | `light.bg.page` #F1F6F9 | 16.87:1 | 4.5:1 |
| secondary text | `light.text.muted` #5B6B85 | `light.bg.surface` #FFFFFF | 5.40:1 | 4.5:1 |
| secondary text on page | `light.text.muted` #5B6B85 | `light.bg.page` #F1F6F9 | 4.96:1 | 4.5:1 |
| links | `light.text.link` #017A96 | `light.bg.surface` #FFFFFF | 4.97:1 | 4.5:1 |
| links on page | `light.text.link` #017A96 | `light.bg.page` #F1F6F9 | 4.57:1 | 4.5:1 |
| primary button | `light.action.primary.text` #07132F | `light.action.primary.bg` #01B6DF | 7.66:1 | 4.5:1 |
| primary button hover | `light.action.primary.text` #07132F | `light.action.primary.hover` #33C6E8 | 9.08:1 | 4.5:1 |
| secondary button | `light.action.secondary.text` #FFFFFF | `light.action.secondary.bg` #07132F | 18.37:1 | 4.5:1 |
| destructive button | `light.action.destructive.text` #FFFFFF | `light.action.destructive.bg` #DC2626 | 4.83:1 | 4.5:1 |
| text on navy | `light.text.inverse` #FFFFFF | `light.bg.inverse` #07132F | 18.37:1 | 4.5:1 |
| secondary text on navy | `light.text.inverseMuted` #C9D6EA | `light.bg.inverse` #07132F | 12.50:1 | 4.5:1 |
| input border on cards | `light.border.input` #7C8DA8 | `light.bg.surface` #FFFFFF | 3.37:1 | 3.0:1 |
| input border on page | `light.border.input` #7C8DA8 | `light.bg.page` #F1F6F9 | 3.10:1 | 3.0:1 |
| focus ring on cards | `light.border.focus` #3D63F5 | `light.bg.surface` #FFFFFF | 4.88:1 | 3.0:1 |
| focus ring on page | `light.border.focus` #3D63F5 | `light.bg.page` #F1F6F9 | 4.48:1 | 3.0:1 |
| recording indicator | `light.state.recording` #DC2626 | `light.bg.surface` #FFFFFF | 4.83:1 | 3.0:1 |
| cyan accent on navy | `light.action.primary.bg` #01B6DF | `light.bg.inverse` #07132F | 7.66:1 | 3.0:1 |
| success message | `light.status.success.text` #176B3F | `light.status.success.bg` #E7F5EE | 5.82:1 | 4.5:1 |
| warning message | `light.status.warning.text` #8A5A00 | `light.status.warning.bg` #FFF4DC | 5.43:1 | 4.5:1 |
| error message | `light.status.error.text` #B23B3B | `light.status.error.bg` #FBEAEA | 5.04:1 | 4.5:1 |
| info message | `light.status.info.text` #017A96 | `light.status.info.bg` #EAF8FC | 4.57:1 | 4.5:1 |
| dark: body | `dark.text.body` #E4ECF7 | `dark.bg.surface` #0B1A3C | 14.37:1 | 4.5:1 |
| dark: body on page | `dark.text.body` #E4ECF7 | `dark.bg.page` #07132F | 15.43:1 | 4.5:1 |
| dark: secondary text | `dark.text.muted` #9DB1CE | `dark.bg.surface` #0B1A3C | 7.83:1 | 4.5:1 |
| dark: links | `dark.text.link` #4FD0F0 | `dark.bg.surface` #0B1A3C | 9.46:1 | 4.5:1 |
| dark: headings | `dark.text.heading` #FFFFFF | `dark.bg.surface` #0B1A3C | 17.11:1 | 4.5:1 |
| dark: primary button | `dark.action.primary.text` #07132F | `dark.action.primary.bg` #01B6DF | 7.66:1 | 4.5:1 |
| dark: focus ring | `dark.border.focus` #4FD0F0 | `dark.bg.surface` #0B1A3C | 9.46:1 | 3.0:1 |

Failures found while drafting, and how the proposal avoids them: white on cyan 2.4:1; cyan on white 2.4:1; the app's current input border 1.7:1; success green and info text on their tints were just under 4.5:1 and were darkened or the tint lightened.

## Approval requested (design review)

This needs a decision from the design owner before SFT-245 can treat the file as final. Please confirm or change:

1. [ ] The core palette and the derived values above (especially cyan hover `#33C6E8`, input border `#7C8DA8`, success green `#176B3F`, amber and red tints).
2. [ ] Primary button as cyan fill with navy text (matches sepenta.io), and destructive actions in red.
3. [ ] Inter for text and Fraunces for headings, self-hosted.
4. [ ] The logo usage rules, and the two derived logo variants as stand-ins.
5. [ ] **Decision: dark theme in or out** for the first release.

Needed from design (not in this proposal): an SVG master of the logo, a tagline-free lockup for small sizes, and a square mark for the browser icon and profile avatar.
