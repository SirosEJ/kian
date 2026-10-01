# Visual verification of the Sepenta theme on the core screens (SFT-247)

Date: 1 Oct 2026. Method: manual verification in a real browser. The real screens, router and components were rendered with fake API data (a temporary page, not kept in the repo), because the live app needs a sign-in. This is not an automated visual diff, and the signed-in screens were not yet looked at with real staging data.

## Screens checked

Sign in and Create account, Home (prompt plus task cards in every state), Activity, Settings (IONOS, Google Calendar, Jira connections and trusted actions), Account (including the delete confirmation), and the profile menu. Checked at desktop width and at 375px phone width (no sideways scrolling on Home, Activity, Settings or Account).

## Measured against the token specification

Values below were read from the rendered page and compared with `apps/web/src/theme/tokens.json`.

| Item | Rendered | Token |
| --- | --- | --- |
| Page background | `#F1F6F9` | `bg.page` (`mist-100`) |
| Body text | `#1B2333` | `text.body` (`ink-800`) |
| Headings | `#07132F`, Fraunces | `text.heading` (`navy-900`), serif |
| Body font | Inter | `font-sans` |
| Primary button (Approve) | fill `#01B6DF`, text `#07132F` | `action.primary` |
| Secondary button (Reject) | fill `#07132F`, text `#FFFFFF` | `action.secondary` |
| Status pill (Needs review) | `#EAF8FC` on `#017A96` | `status.info` |
| Cards | `#FFFFFF`, 12px radius | `bg.surface`, `radius.md` |
| Top bar / avatar | `#FFFFFF` / `#07132F` | `bg.surface` / `bg.inverse` |
| Logo | `sepenta-logo-light-bg.png` on light surfaces, loaded | light-background variant |
| Fonts loaded | Inter Variable, Fraunces Variable | self-hosted |

## What changed in the screens

Every `<button>` on the screens is now the shared `Button` (primary for the main action, ghost or secondary for the rest, destructive for deletion); every message is the shared `Alert`; task states are shown with `StatusBadge` (words plus colour); Settings is split into Connections and Trusted actions cards; Activity and trusted actions use a common list style. Tests fail if a screen uses a raw `<button>`, a hand-written alert paragraph, an inline colour or any raw colour value (`apps/web/src/appearance.test.ts`).

## Remaining hard-coded colours

None in the app source. The only places holding colour values are `apps/web/src/theme/tokens.json` and the logo images, whose colours are part of the raster artwork.

## Known gaps for follow-up

- The logo is a raster stand-in; an SVG master, a tagline-free version for the header and a square mark are still needed from design.
- No automated visual-diff tooling; consider it with the CI story (SFT-248) if the owner wants it.
- The Settings page still lists the IONOS connect form above the connected services; reordering is a layout polish item.
- The signed-in screens have not been reviewed with real staging data by me.
