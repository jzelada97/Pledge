---
version: alpha
name: "Calm Utility"
description: "Interfaces that disappear. Detail that doesn't."
source: "Fuzz style calm-utility with an Apple glass layer, adapted for Fianzas (WCAG AAA, Lucide icons). See ## Fianzas overrides

Fuzz ships Calm Utility at WCAG AA. Fianzas keeps AAA and adds an Apple-style glass layer on top:

| Token / element | Fuzz | Fianzas | Why |
|---|---|---|---|
| primary | #5A5AC2 | #004C99 | Apple blue, darkened to 7.7:1 on the page background (AAA) |
| page background | #FAFAFA | #F5F5F7 | Apple light grey |
| text | #111111 | #1D1D1F | Apple near-black |
| secondary emphasis | #2E3A5E | #1D1D1F | dark tiles (overview panel) |
| muted text | #6F6F6F | #4F4F4F | 5.02:1 is below AAA |
| error | #E5484D | #9B1C1C | 3.91:1 is below AA, and it is used as text (stop flow) |
| subtle fill | #FFFFFF | #F0F0F3 | white on white cards hid hover and inset states |
| focus ring | #5A5AC2 | #0071E3 | Apple focus blue |
| type | Inter | SF (system) → Inter | SF on Apple devices, Inter elsewhere |
| radius | 10px | 12px; cards ~17px; buttons pill | Apple shapes |
| icons | Phosphor light | Lucide 1.5 | the style's declared fallback; no migration mid-hackathon |

Glass layer:
- The site header is sticky and frosted (`bg-card/80`, blur, saturate). Text on it is
  `foreground`, never `muted-foreground`, so it stays AAA over any content scrolled beneath.
- Dialogs keep an opaque panel; only the overlay behind them is blurred.
- Every frosted surface carries `data-glass` and turns solid under
  `prefers-reduced-transparency: reduce`.
- Cards: white, hairline ring, soft shadow `0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.04)`.

`success` and `warning` are not part of the Fuzz style; they keep the Fianzas values in
`app/globals.css`. Dark mode is not styled yet.

## Colors

- **Primary (#004C99):** the single most important action on a view, selection and focus. Never
  decoration, icons or headings.
- **Secondary (#1D1D1F, shadcn `accent`):** dark tiles and supporting emphasis.
- **Neutral (#F5F5F7):** page background. **Surface (#FFFFFF):** cards and panels.
- **Subtle (#F0F0F3, shadcn `muted`/`secondary`):** hover fills and inset blocks.
- **Outline (#E5E5EA):** decorative hairlines only. **Outline-strong (#86868B):** input, checkbox
  and toggle borders.
- **Error (#9B1C1C):** errors and the stop action.

## Typography

- Headlines: SF Pro Display (Inter fallback) 600, tracking -0.02em. Body: SF Pro Text (Inter fallback) 13–18px, line height 1.45–1.5.
- Labels: Geist Mono 11–14px, tracking 0.04em. Good for amounts, dates and codes.
- Sentence case everywhere. No all-caps labels.

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

- AAA text contrast (≥7:1) on the surfaces it sits on; control borders and focus ≥3:1.
- Visible `:focus-visible` ring in #0071E3.
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
