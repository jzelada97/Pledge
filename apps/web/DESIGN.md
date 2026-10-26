---
version: alpha
name: "Calm Utility"
description: "Interfaces that disappear. Detail that doesn't."
source: "Fuzz style calm-utility with an Apple glass layer and the Pledge logo palette (WCAG AA, Lucide icons). The Pledge overrides section lists every change."
colors:
  primary: "#00796E"
  on-primary: "#FFFFFF"
  secondary: "#0D121F"
  on-secondary: "#FFFFFF"
  neutral: "#F4F7F7"
  on-neutral: "#0D121F"
  surface: "#FFFFFF"
  on-surface: "#0D121F"
  subtle: "#EBF1F0"
  muted: "#5B6B69"
  outline: "#DCE5E3"
  outline-strong: "#7A8886"
  focus-ring: "#169A8E"
  error: "#9B1C1C"
  success: "#17582F"
  highlight: "#F6A47C"
  highlight-soft: "#FDEDE4"
  highlight-text: "#A84A1B"
  brand: "#1EB5A6"
colorsDark:
  primary: "#3DD6C6"
  on-primary: "#00201C"
  neutral: "#070B0E"
  surface: "#10161A"
  subtle: "#1A2227"
  on-neutral: "#EEF4F3"
  muted: "#97A5A7"
  outline: "#283136"
  outline-strong: "#84918F"
  focus-ring: "#1EB5A6"
  error: "#FF9F99"
  success: "#7BD69A"
  highlight: "#FFB089"
  highlight-soft: "#2A1E19"
typography:
  headline: { fontFamily: "SF Pro Display, Inter", fontWeight: 600, letterSpacing: -0.02em }
  headline-display: { fontSize: 72px, lineHeight: 1.0 }
  headline-lg: { fontSize: 48px, lineHeight: 1.05 }
  headline-md: { fontSize: 30px, lineHeight: 1.1 }
  body-lg: { fontFamily: "SF Pro Text, Inter", fontSize: 18px, fontWeight: 400, lineHeight: 1.5 }
  body-md: { fontFamily: "SF Pro Text, Inter", fontSize: 15px, fontWeight: 400, lineHeight: 1.5 }
  body-sm: { fontFamily: "SF Pro Text, Inter", fontSize: 13px, fontWeight: 400, lineHeight: 1.45 }
  label: { fontFamily: "Geist Mono", fontWeight: 500, letterSpacing: 0.04em, sizes: [11px, 12px, 14px] }
  logo: { fontFamily: "Montserrat", fontWeight: 700, use: "the wordmark only" }
rounded: { none: 0px, sm: 7px, md: 12px, lg: 17px, xl: 24px, full: 9999px }
spacing: { unit: 4px, xs: 4px, sm: 8px, md: 16px, lg: 24px, xl: 32px, gutter: 24px, margin: 20px }
elevation: "0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.04)"
accessibility:
  wcagLevel: "AA"
  wcagVersion: "2.2"
  contrastPairs:
    - { fg: on-neutral, bg: neutral, ratio: 17.35 }
    - { fg: on-primary, bg: primary, ratio: 5.30 }
    - { fg: primary, bg: neutral, ratio: 4.92 }
    - { fg: primary, bg: subtle, ratio: 4.64 }
    - { fg: on-secondary, bg: secondary, ratio: 18.69 }
    - { fg: muted, bg: neutral, ratio: 5.20 }
    - { fg: muted, bg: subtle, ratio: 4.90 }
    - { fg: muted, bg: highlight-soft, ratio: 4.91 }
    - { fg: highlight-text, bg: highlight-soft, ratio: 5.03 }
    - { fg: on-neutral, bg: highlight, ratio: 9.36 }
    - { fg: error, bg: neutral, ratio: 7.57 }
    - { fg: success, bg: subtle, ratio: 7.43 }
    - { fg: outline-strong, bg: neutral, ratio: 3.42, use: "non-text: control border" }
    - { fg: focus-ring, bg: neutral, ratio: 3.22, use: "non-text: focus indicator" }
  minTapTarget: 44
  minTextSize: 11
icons:
  library: "Lucide (lucide-react)"
  strokeWidth: 1.5
  size: 20
  fill: "none; outline only"
---

# Calm Utility

Interfaces that disappear. Detail that doesn't. Chrome recedes; content and actions are the only
things with contrast. Motion explains a change and is never decoration.

## Pledge overrides

Fuzz ships Calm Utility at WCAG AA. Pledge stays at AA, adds an Apple-style glass layer, and takes its colours from
the logo with a complementary scheme: teal (the hue of the "p") as the main colour, the logo's ink `#0D121F` for
text and dark tiles, teal-tinted neutrals, and **apricot**, teal's complement on the colour wheel, as a sparing
accent for what needs attention (60 % neutrals, 30 % ink, 10 % teal, a touch of apricot).

| Token / element | Fuzz | Pledge | Why |
|---|---|---|---|
| primary | #5A5AC2 | #00796E | the logo's teal hue, at 4.9:1 on the page background (AA) |
| page background | #FAFAFA | #F4F7F7 | near-white with a hint of the logo's teal |
| text | #111111 | #0D121F | the logo's ink |
| secondary emphasis | #2E3A5E | #0D121F | dark tiles (overview panel, home) |
| muted text | #6F6F6F | #5B6B69 | teal-tinted grey, 4.9:1 on fills |
| error | #E5484D | #9B1C1C | 3.91:1 is below AA, and it is used as text (stop flow) |
| subtle fill | #FFFFFF | #EBF1F0 | white on white cards hid hover and inset states |
| focus ring | #5A5AC2 | #169A8E | mid teal, ≥3:1 on the page |
| highlight | — | #F6A47C / #FDEDE4 / #A84A1B | apricot fill, soft tint and text: "Needs your answer", one home tile, the note on passes |
| success | — | #17582F | greener than the teal, so "Active" never reads as a button |
| type | Inter | SF (system) → Inter | SF on Apple devices, Inter elsewhere |
| radius | 10px | 12px; cards ~17px; buttons pill | Apple shapes |
| icons | Phosphor light | Lucide 1.5 | the style's declared fallback; no migration mid-hackathon |

Glass layer:
- The site header is sticky and frosted (`bg-card/80`, blur, saturate). Text on it is
  `foreground`, never `muted-foreground`, so it stays readable over any content scrolled beneath.
- Dialogs keep an opaque panel; only the overlay behind them is blurred.
- Every frosted surface carries `data-glass` and turns solid under
  `prefers-reduced-transparency: reduce`.
- Cards: white, hairline ring, soft shadow `0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.04)`.

`success` and `warning` are not part of the Fuzz style; their values live in `app/globals.css`.
The logo's own teal (`--brand`, `#1EB5A6`) is for the logo only; at 2.4:1 on the page it never carries UI.

## Colors

- **Primary (#00796E):** the single most important action on a view, selection and focus. Never
  decoration, icons or headings.
- **Secondary (#0D121F, shadcn `accent`):** dark tiles and supporting emphasis; the logo's ink.
- **Neutral (#F4F7F7):** page background. **Surface (#FFFFFF):** cards and panels.
- **Subtle (#EBF1F0, shadcn `muted`/`secondary`):** hover fills and inset blocks.
- **Outline (#DCE5E3):** decorative hairlines only. **Outline-strong (#7A8886):** input, checkbox
  and toggle borders.
- **Error (#9B1C1C):** errors and the stop action.
- **Highlight (apricot):** only for what asks the user to act, plus one home tile. Never on buttons, so it
  can't compete with the teal primary or be mistaken for the red stop action.

## Typography

- Headlines: SF Pro Display (Inter fallback) 600, tracking -0.02em. Body: SF Pro Text (Inter fallback) 13–18px, line height 1.45–1.5.
- Labels: Geist Mono 11–14px, tracking 0.04em. Good for amounts, dates and codes.
- Sentence case everywhere. No all-caps labels.

## Dark mode and languages

- **Themes:** `next-themes` puts `dark` on `<html>`; the default follows the system. Dark tokens keep the
  same scheme: ink canvas `#070B0E`, `#10161A` panels, `#1A2227` fills, light teal primary `#3DD6C6` with
  `#00201C` text, apricot `#FFB089`; all text ≥4.5:1.
  Use tokens only: `--primary-hover` for the primary hover, `--pass-from`/`--pass-to` for Wallet passes.
- **Languages:** English, European Portuguese and Spanish. Copy lives in `lib/i18n/messages/{en,pt,es}.ts`;
  `en.ts` defines the keys and TypeScript fails if `pt` or `es` miss one. Server components use
  `await getI18n()`, client components `useI18n()`; both return `{ t, f }`, where `f` formats money, dates,
  percentages and "in N days" for the active language. The choice is the `locale` cookie; a first visit
  follows the browser's language.
- **Preferences menu** (`components/preferences-menu.tsx`) sits in every header: appearance and language
  as segmented controls.

## App layouts (Apple-inspired)

- **Landlord, desktop (lg+):** a macOS split view (`components/landlord-shell.tsx`): sidebar with filters and
  totals · deposit list (selected row in primary) · detail pane. Each column scrolls on its own. The pane has
  a frosted toolbar (`PaneToolbar`) with the title and the actions on the right.
- **Landlord, phone:** an iOS navigation stack. `/landlord` shows the list with a large title and filter pills;
  every other route shows the pane with a back button and the actions in a bottom bar (`BottomBar`).
- **Tenant:** an iOS app. Deposits are Wallet-style passes (`DepositPass`); tapping one opens
  `/tenant/deposits/[id]` with the details as a grouped list and the action pinned to the bottom.
- **Invitation:** iOS onboarding. Terms first, then one full screen per step with a progress bar and the
  action at the bottom; focus moves to each new screen's title.
- **Content:** grouped inset sections (`components/grouped.tsx`): a small heading, a white rounded panel with
  hairline rows of at least 44px, and an optional footnote.

## Layout and shape

- 4px base grid. Columns 12 / 8 / 4; margins 64px / 32px / 20px (desktop / tablet / mobile).
- Radius 12px; cards ~17px; buttons are pills. 1px hairline borders.
- One effect: the soft shadow above. No stacked effects, no cards inside cards.

## Motion

- micro 120ms `cubic-bezier(.2,0,0,1)` for hover and press; standard 200ms
  `cubic-bezier(.32,.72,0,1)` for popovers and menus; sheets 350ms spring.
- Honor `prefers-reduced-motion`: swap movement for an instant change or a fade ≤150ms.
- No `transition: all`, no animated width, height, top or left, no looping animation.

## Accessibility

- AA text contrast (≥4.5:1, ≥3:1 for large text) on the surfaces it sits on; control borders and focus ≥3:1.
- Visible `:focus-visible` ring in #169A8E (dark: #1EB5A6).
- Tap targets ≥44×44. Text ≥11px, body ≥12px.
- Never signal state by color alone; pair it with an icon, label or weight change.
- Layouts survive 200% text.

## Never

- No all-caps labels.
- No more than 2 gradients per screen, only tonal steps of primary, secondary or neutral; no
  gradient text.
- No single word picked out in a headline by color, italics, highlight or underline.
- No small label over a heading that only repeats it; a label carries a date, a count, a code or a
  destination.
- No invented ratings, user counts, quotes, logo walls or placeholder people.
- No raw hex in components, no stock Tailwind indigo, violet or slate; tokens only.
- No emoji as icons and no second icon library.
- No "Thanks!", "Sent" or "You're in" without a real request behind it.
- No first screen without the headline, one line and the main action at 1280×800 and 390 wide; no
  100vh heroes.
- No centred hero + three identical icon cards + CTA band + four-column footer.

## Voice

Plain, precise, friendly, brief. Avoid hype, jargon, exclamations and cuteness. Product terms
follow `apps/web/CLAUDE.md`: never "wallet", "seed", "XLM", "gas"; yield is always "variable".
