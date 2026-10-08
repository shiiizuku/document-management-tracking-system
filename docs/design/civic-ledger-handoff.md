# Handoff spec: Civic Ledger redesign

Status: approved design, ready to implement (2026-10-07).
Source of truth: the claude.ai Design canvas **DTS Screen Designs**, row "Civic Ledger — full app"
(boards prefixed `CL-`): https://claude.ai/artifact/3CQycW3duEotwm3heAw3pn. Where this document and a board
disagree, this document wins: it records decisions made after some boards were drawn.

## Overview

A re-skin of `apps/web`, not a rebuild. Routes, data, capabilities and workflow behaviour stay as they are.
What changes:

1. **Themes.** The five accents (Default, Blue, Green, Violet, Rose) become four whole-palette themes:
   **Neutral pastel** (default), **Sage pastel**, **Blush pastel**, and **Civic Ledger** (the original dark-green
   look). A theme sets the background, surfaces, borders, text, primary colour and sidebar, not just the accent.
2. **Type.** Newsreader for display headings, Public Sans for UI and body, tabular figures for tracking
   numbers.
3. **Shell.** The existing left sidebar is restyled. The theme picker becomes a palette button with a
   swatch-only popover in the sidebar footer.
4. **Fields.** Every text field, select and date input uses one of two sizes. Each has a 14px inset and a
   drawn chevron or calendar icon.
5. **Filters.** On the Registry and the Audit trail, the filter fields move behind an **Advanced search**
   button. Active filters stay visible as removable chips.
6. **Status.** The four-tone status signal keeps its fixed colours in every theme, and each tone gains a
   glyph so it reads without colour.

Out of scope: the public landing page and tracker (`Idea-*` boards), the "Your move" detail redesign beyond
the bar described below, and phone-specific navigation (bottom tab bar) — the current `< lg` sheet nav stays.

## Where the current code is

| Concern | File |
|---|---|
| Colour tokens, accents, dark mode, motion | `apps/web/app/theme.css` |
| Theme boot script (runs before first paint), fonts | `apps/web/app/layout.tsx`, `apps/web/app/fonts/` |
| Theme state, `ACCENTS`, localStorage keys | `apps/web/src/components/theme-provider.tsx` |
| Colour-mode toggle and accent popover | `apps/web/src/components/theme-toggle.tsx` |
| Sidebar, header, mobile nav sheet, account menu | `apps/web/src/components/dts/app-shell.tsx` |
| Nav items and sections | `apps/web/src/components/dts/nav-items.ts` (unchanged) |
| Status badge and priority label | `apps/web/src/components/dts/status-badge.tsx` |
| Filter bar | `apps/web/src/components/dts/filter-bar.tsx` |
| Registry, Audit screens | `apps/web/src/features/documents/registry-screen.tsx`, `apps/web/src/features/audit/audit-screen.tsx` |
| shadcn primitives | `apps/web/src/components/ui/*` |

## Design tokens

### Theme palettes (light)

Each theme defines the same token set. Implement as `:root[data-theme='<id>']` blocks in `theme.css`, mapping
onto the shadcn variables in the second column. Ids: `neutral`, `sage`, `blush`, `civic`. Hex is the design
value; convert to `oklch()` to match the file's convention.

| Design token | shadcn / app variable | Neutral pastel | Sage pastel | Blush pastel | Civic Ledger | Usage |
|---|---|---|---|---|---|---|
| ground | `--background` | #F5F3EF | #F1F4F1 | #F6F2F1 | #F3F5F2 | Page background |
| surface | `--card`, `--popover` | #FDFCFA | #FBFCFB | #FDFBFB | #FBFCFA | Cards, panels, dialogs, popovers |
| surface2 | `--muted`, `--secondary` | #EEEBE5 | #E8EEE9 | #EFE8E7 | #EEF2EE | Table header row, selected swatch, open "Advanced search" button |
| hoverRow | `--accent` | #F2EFE9 | #EEF2EE | #F3EDEC | #F0F4F0 | Row and item hover (shadcn's `accent` is the hover fill) |
| line | `--border` | #DDD8CF | #D3DDD6 | #E0D5D3 | #CDD6CF | Card borders, dividers |
| line2 | `--border-subtle` (new) | #E9E5DE | #E3EAE5 | #ECE4E2 | #E1E7E2 | Row dividers inside tables and lists |
| field | `--input` | #928C80 | #819086 | #988986 | #7F9186 | Text field, select and textarea borders |
| ink | `--foreground` | #2D2A26 | #22302A | #2F2627 | #13291F | Body text, headings |
| ink2 | `--foreground-secondary` (new) | #4F4A43 | #43524A | #524546 | #3D5248 | Column headers, field labels, descriptions |
| ink3 | `--muted-foreground` | #625C54 | #56655D | #66585A | #4F6359 | Hints, timestamps, metadata, chevrons |
| accent | `--primary`, `--ring` | #527061 | #49745E | #895C64 | #1F6B45 | Primary buttons, links, focus ring, active-filter count badge |
| onAccent | `--primary-foreground` | #FFFFFF | #FFFFFF | #FFFFFF | #FFFFFF | Text on primary |
| accentHover | `--primary-hover` (new) | #4A6557 | #3F6552 | #714B53 | #14502F | Primary button and link hover |
| gold | `--seal` (new) | #C4A57A | #BFA06B | #C4A57A | #B8892F | Seal ring, active-filter chip border, focus accent in admin |
| goldText | `--seal-foreground` (new) | #7E6440 | #7A6238 | #7E6440 | #8A6420 | Eyebrow labels, High priority, division codes |
| goldTint | `--seal-tint` (new) | #F6EEDF | #F4EEDD | #F6EEDF | #FBF4E2 | Active-filter chip fill |
| bar | `--sidebar` | #E6E1D8 | #DCE6DF | #EADFE0 | #13291F | Sidebar and "Your move" bar background |
| barInk | `--sidebar-foreground` | #2D2A26 | #22302A | #2F2627 | #F3F5F2 | Active nav item, brand, user name |
| barMuted | `--sidebar-muted-foreground` (new) | #5E584F | #4F5E56 | #5F5153 | #B9C7BE | Inactive nav items, section heading |
| barPill | `--sidebar-accent` | #F5F2EC | #F1F5F2 | #F8F3F3 | #22382D | Active nav item fill, Search button fill, open palette button |
| barLine | `--sidebar-border` | #C9C2B6 | #B5C4BA | #CDBDBE | #4F6359 | Search button border, secondary button border on the bar |
| barAvatar | `--sidebar-avatar` (new) | #D6CFC3 | #C9D6CD | #DCCDCE | #2F4A3C | Avatar fill, sidebar footer divider |
| barUnderline | `--sidebar-primary` | #527061 | #49745E | #895C64 | #D9B56A | Underline under the active nav label |
| barGold | `--sidebar-seal` (new) | #79603C | #7A6238 | #79603C | #D9B56A | Seal ring and "DTS" text in the sidebar, unread dot |
| goldBtn | `--move-action` (new) | #D8C3A0 | #D4BC8A | #D9C29A | #D9B56A | Primary button on the "Your move" bar |
| onGold | `--move-action-foreground` (new) | #2D2A26 | #22302A | #2F2627 | #13291F | Text on that button |

Contrast is enforced by `apps/web/test/theme-palettes.test.ts`: 4.5:1 for text and 3:1 for field borders, the focus
ring and the active-nav underline, across all four themes in light and dark mode. The values above already include the
2026-10-08 contrast fix (darker primary in the pastels, darker sidebar seal text, and 3:1 field borders).

### Dark mode

Dark mode stays an independent toggle (`.dark` on `<html>`), as today. **Each theme has its own dark palette**:
implement `:root.dark[data-theme='<id>']` blocks. In dark mode `--primary` is a *light* tone with *dark* text on
it, the same pattern as shadcn's dark primary. The status signal's dark values are shared by all themes. Canvas
boards: `CL-Today-Dark`, `CL-Journey-Dark` (each has the palette popover), and the dark row of `CL-Themes`.

| Token | Neutral dark | Sage dark | Blush dark | Civic dark |
|---|---|---|---|---|
| `--background` | #191816 | #131A16 | #1C1718 | #0E1A14 |
| `--card`, `--popover` | #22201D | #1B241F | #252021 | #16251D |
| `--muted`, `--secondary` | #2A2825 | #212C26 | #2D2728 | #1B2C23 |
| `--accent` (hover fill) | #2D2A26 | #24302A | #312A2B | #1E3127 |
| `--border` | #3B3732 | #33433A | #403637 | #2B4236 |
| `--border-subtle` | #312E2A | #2A3830 | #362E2F | #253A2F |
| `--input` | #706A61 | #5F7166 | #76696B | #587163 |
| `--foreground` | #EDE9E3 | #E7EEEA | #F0E8E9 | #E6EDE8 |
| `--foreground-secondary` | #CBC4BA | #BFCCC4 | #D0C2C4 | #B3C4B9 |
| `--muted-foreground` | #ABA398 | #A0B0A6 | #B1A1A4 | #9DB1A5 |
| `--primary`, `--ring` | #A9C4B5 | #9CCDB2 | #D9AAB2 | #8FD1A8 |
| `--primary-hover` | #C4D9CD | #BCE0CB | #E8C6CB | #B5E3C6 |
| `--primary-foreground` | #191816 | #131A16 | #1C1718 | #0E1A14 |
| `--seal` | #BFA06B | #BFA06B | #C4A57A | #C9A052 |
| `--seal-foreground` | #D8BE8E | #D6BC88 | #DCC296 | #D9B56A |
| `--seal-tint` | #2F2A1F | #2C2A1D | #302921 | #2E2715 |
| `--sidebar` | #141311 | #0F1512 | #161213 | #0A140F |
| `--sidebar-foreground` | #EDE9E3 | #E7EEEA | #F0E8E9 | #E6EDE8 |
| `--sidebar-muted-foreground` | #ABA398 | #A0B0A6 | #B1A1A4 | #9DB1A5 |
| `--sidebar-accent` | #25231F | #1D2822 | #282223 | #17271F |
| `--sidebar-border` | #45403A | #3D4F44 | #4A3F41 | #3A5246 |
| `--sidebar-avatar` | #302D29 | #28352D | #342C2D | #22352B |
| `--sidebar-primary` | #A9C4B5 | #9CCDB2 | #D9AAB2 | #D9B56A |
| `--sidebar-seal` | #D8BE8E | #D6BC88 | #DCC296 | #D9B56A |
| `--move-action` | #D8C3A0 | #D4BC8A | #D9C29A | #D9B56A |
| `--move-action-foreground` | #191816 | #131A16 | #1C1718 | #13291F |

In every dark theme:
- The sidebar gets a 1px `--sidebar-avatar` right border.
- The "Your move" bar is a raised `--card` panel with a 2px `--seal` top rule, not the sidebar colour.
- Text fields use `--card` as their fill instead of white.
- Signal pills use the existing dark `--signal-*` values: wait #3B3114 / #F0D58C, move #1C3350 / #AFCBEC,
  done #17392A / #9FD6B4, closed #2A302C / #C3CAC5. Urgent is #4A1C17 / #F4B4AC.

### Status signal (fixed in every theme)

Keep the existing `--signal-*` / `--on-signal-*` variables and their dark values. The design's light hexes, for
checking the oklch values: wait #F6E8C4 / #5E4710, move #D8E5F3 / #234A73, done #D6ECDF / #1D5A3A,
closed #E4E6E2 / #4A514C, urgent #F6D3CF / #7D1D17.

Add a glyph before the label in `StatusBadge`, chosen by tone, so status reads without colour:

| Tone | Statuses | Glyph |
|---|---|---|
| wait | PENDING, FOR_REVISION, FOR_INITIAL | Ring: 6px circle, 2px `currentColor` border |
| move | IN_PROCESS, FOR_SIGNATURE, FOR_RELEASE | Dot: 9px filled `currentColor` circle |
| done | SIGNED, RELEASED, COMPLIED | Check: 11px stroke check, stroke-width 3 |
| closed | ARCHIVED | Dash: 9×2px bar |

Glyphs are `aria-hidden`; the label text stays. Badge becomes a pill: `rounded-full`, `px-2.5 py-1`, `text-xs
font-semibold`, `gap-1.5`, `whitespace-nowrap`. (Currently `text-[10px] font-bold rounded-xl`.)

**Priority:** Low and Normal in `--muted-foreground`, weight 500. High in `--seal-foreground`, weight 700, with an
up-arrow glyph. Urgent is a pill (#F6D3CF / #7D1D17 light, via `--priority-urgent`), weight 700, with an "!"
glyph. Write labels in sentence case (`Urgent`, not `URGENT`).

### Typography

| Role | Family | Size / weight | Where |
|---|---|---|---|
| Display: page titles | Newsreader 400 | 44px / 1.05 (`text-[2.75rem]`) | `PageHeader` title |
| Display: section and dialog titles | Newsreader 400 | 26–30px | "Pending by division", dialog titles, panel titles |
| Display: big numbers | Newsreader 400 | 44–48px, `tabular-nums` | Dashboard and report tiles |
| Eyebrow | Public Sans 700 | 12px, `tracking-[0.16em]`, uppercase, `--seal-foreground` | `.eyebrow` (change its colour from muted to seal) |
| Body | Public Sans 400 | 15px / 1.5 | Default |
| Labels, column headers | Public Sans 700 | 12px, `tracking-[0.04–0.06em]`, uppercase for table headers | Field labels, `<th>` |
| Tracking numbers | Public Sans 600 | `tabular-nums tracking-[0.04em]` | Everywhere a `DTS-YYYY-NNNNNN` appears |

Self-host both families with `next/font/local`, the same way Inter is set up today. Commit the woff2 files and
licence under `apps/web/app/fonts/` and update its README. Both families are under the SIL Open Font License.
Replace `--font-sans` with Public Sans and add `--font-display` for Newsreader. Do not load from Google at runtime.

### Shape and spacing

- Radius: buttons and filter fields 10px; form fields, cards and list rows 12–16px; dialogs and popovers 14–18px;
  pills `rounded-full`. Set `--radius: 0.75rem` (12px) and use `rounded-[10px]` where 10px is called for.
- Minimum touch target **44px** for every button, link-button, nav item, swatch and icon button.
- Page container: `max-w-[1280px]`, `px-6`, `py-8`; vertical rhythm between page sections: `gap-6` (24px).

## Components

| Component | Variant | Spec | Notes |
|---|---|---|---|
| Button | primary | h-11 (44px), px-5, rounded-[10px], `--primary` fill, 15px/600 | Hover `--primary-hover` |
| Button | outline | h-11, 1.5px `--primary` border, `--primary` text, transparent | "Open the registry", "Forward" |
| Button | link | h-11, underline, `--foreground` | "View routing slip" |
| Button | destructive | h-11, #7D1D17 fill, white | Keep `--destructive` |
| Button | on "Your move" bar | Primary: `--move-action` fill and `--move-action-foreground` text, weight 700. Secondary: 1px `--sidebar-border`, `--sidebar-foreground` | |
| Button | disabled | `--muted` fill, `--muted-foreground` text | |
| Button | focus | 3px `--background` gap then 2px `--seal` ring | Replace `ring-ring/50` |
| Input (form size) | default | **h-12 (48px)**, rounded-xl (12px), 1.5px `--input`, **px-3.5 (14px)**, **16px** text, white fill | Sign in, request account, dialogs, admin forms |
| Input (filter size) | default | **h-11 (44px)**, rounded-[10px], 1.5px `--input`, px-3.5, **15px**, white fill | Search and filter bars |
| Select | both sizes | Same as Input, plus `appearance-none`, `pr-11` (44px), and a drawn 16px chevron (`ChevronDown`) at `right-4`, `pointer-events-none`, `--muted-foreground` | Applies to the shadcn `SelectTrigger` too: match its height, padding and icon position |
| Date input | filter size | As Select, with a 16px `Calendar` icon at `right-4`. Make `::-webkit-calendar-picker-indicator` transparent and stretch it 44px wide over the icon so clicking the icon still opens the picker | Audit From and To |
| Textarea | | rounded-xl, 1.5px `--input`, `px-3.5 py-3`, 16px | |
| Field error | | 2px #7D1D17 border, message below in #7D1D17 13px/600, `aria-invalid` and `aria-describedby` | |
| Checkbox, radio | | 20px, `accent-color: --primary`, label row min-h-11 | |
| Card | | `--card`, 1px `--border`, rounded-2xl (16px), p-5 | |
| Table | | Container `--card`, 1px `--border`, rounded-2xl, `overflow-x-auto`. Header row `--muted`, 12px/700 uppercase `--foreground-secondary`, `px-4 py-3`. Rows `px-4 py-3`, 1px `--border-subtle` dividers, hover `--accent` | Sortable headers are `<button>`s with ↕ / ↓ |
| Empty state | | 1.5px dashed border, rounded-2xl, centred; 44px icon disc in `--muted`; Newsreader 22px title; 14px `--muted-foreground` copy | Keep current copy |
| Alert | destructive | #F6D3CF fill, #7D1D17 text, rounded-xl, icon left | |
| Toast (sonner) | | Dark: `--sidebar` fill (Civic) or #13291F on pastels, light text, check icon in `--seal` | |
| Dialog | | `--card`, rounded-[18px], p-7, max-w-[560px]; scrim rgba(10,22,16,.6); 44px close button in `--muted` | Eyebrow tracking number above a Newsreader title |
| Active-filter chip | | h-8, rounded-full, 1px `--seal` border, `--seal-tint` fill, #5E4710 text 13px/600, trailing × | Removes that filter; `aria-label="Remove filter <Name>: <Value>"` |

## Screens

### Shell and sidebar (`app-shell.tsx`, `theme-toggle.tsx`)

Keep the structure: sticky `w-64` sidebar at `lg+` with the collapse toggle, and a sheet nav below `lg`. Restyle it:

- Background `--sidebar`, text `--sidebar-foreground`. Light themes have no border; dark gets a right border.
- Top to bottom: brand (38px seal ring in `--sidebar-seal` with "DTS" in Newsreader, then "Document Tracking" in
  Newsreader 18px, then "MGB · [Region]" at 12px muted), then a Search button (min-h-11, `--sidebar-accent` fill,
  1px `--sidebar-border`, `Ctrl K` kbd hint, opens the command palette), then the nav.
- Nav items: min-h-11, `px-3`, rounded-[10px], 18px icon, gap-3, 15px. Inactive items `--sidebar-muted-foreground`.
  The active item gets a `--sidebar-accent` fill, `--sidebar-foreground` text at weight 600, and its label
  underlined: `decoration-[--sidebar-primary] decoration-[3px] underline-offset-[7px]`.
- The "Administration" heading: 11px/700, `tracking-[0.12em]`, uppercase, muted. Its hide-when-empty logic is
  unchanged.
- Footer row, above the collapse toggle: avatar (36px, `--sidebar-avatar`), then name and "[Role] · [Division]"
  (truncate with an ellipsis), then the **palette button**, then the notifications bell (unread dot
  `--sidebar-seal` with a 2px `--sidebar` ring). The colour-mode (sun/moon) toggle stays next to these.
- Collapsed (`w-16`): icons only, tooltips on hover, palette button and bell stacked.
- Collapse toggle: keeps `aria-expanded`, adds `aria-keyshortcuts="Control+B Meta+B"`, and its tooltip shows the
  `Ctrl B` (`⌘B` on a Mac) hint. Ctrl/⌘B toggles the sidebar at `lg+`, except while focus is in an input, textarea,
  select or contenteditable. It never touches Ctrl/⌘K. The state is still remembered per device. The width
  transition is off under `prefers-reduced-motion`.
- **Collapsed-sidebar top bar (`lg+` only).** While the sidebar is collapsed, a top bar spans the content column:
  sticky, `h-14`, `--card` fill, 1px bottom `--border`, matching the below-`lg` bar. It holds one search bar, a
  button drawn as a filter-size field (44px, rounded-[10px], 1.5px `--input` border, `max-w-md`), with a search icon,
  the placeholder "Search documents, actions and screens…" and a `Ctrl K` hint. It opens the same command palette as
  every other Search button, with `aria-label="Search documents, actions and screens"` and
  `aria-keyshortcuts="Control+K Meta+K"`. The collapsed rail then drops its own Search button, so there is one search
  entry point on screen. Expanded, there is no top bar at `lg+` and search stays in the sidebar. Below `lg`
  nothing changes.

### Theme picker (replaces the accent popover)

- Trigger: 44px ghost icon button (`Palette` icon), `aria-label="Theme: <name>"`, `aria-expanded`. While open its
  fill is `--sidebar-accent`.
- Popover: opens upward from the footer (`side="top" align="start"`; `side="right"` when collapsed). Width 216px,
  p-3, rounded-[14px], `--popover`, 1px `--border`, shadow `0 12px 30px rgb(0 0 0 / .18)`.
- Heading "Theme" 13px/600. Below it a 4-column grid of **swatch-only** buttons with no visible names. Each
  swatch: 44×44, rounded-[10px], centred 18px dot in the theme's `accent` with a 3px ring in its `bar` colour.
  Order: Neutral pastel, Sage pastel, Blush pastel, Civic Ledger.
- Each swatch has `aria-label="<Theme name>"` and `aria-pressed`. The selected swatch gets a `--muted` fill and an
  inset 1.5px `--primary` ring.
- Picking a swatch applies the theme immediately and closes the popover. Esc closes it and returns focus to the
  trigger (Radix Popover does this already).

**State and storage.** Rename the concept from accent to theme:
- `THEMES = ['neutral', 'sage', 'blush', 'civic'] as const`, default `neutral`.
- Set `data-theme` on `<html>` (drop `data-accent`).
- Storage key `dts.theme.v1`. Note that `dts.theme` already holds the light/dark mode, so don't reuse that key.
- Update the boot script in `layout.tsx` to set `data-theme` before first paint. Migrate an old
  `dts.accent.v1` value once: `green → sage`, `rose → blush`, everything else → `neutral`. Then remove the old key.
- Keep the 180ms colour transition and the reduced-motion guard. Switching theme must not remount forms.

### Today (dashboard, `features/dashboard/dashboard-screen.tsx`)

- Header: eyebrow "Today · <weekday, Month D>", title "Good day, <first name>", description unchanged,
  outline "Open the registry".
- Four tiles in `grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4`. **Every tile is a link**, including
  Overdue (today it has no `href`):
  Awaiting acceptance → `/documents?status=PENDING`, In progress → `/documents?status=IN_PROCESS`,
  Overdue → `/documents?overdue=true` (see "Overdue filter" below), All documents → `/documents`.
- Tile layout: an uppercase 13px/700 label with a status pill or icon on the right, then the number in Newsreader
  48px, then the hint, then "View list →" in `--primary`. Overdue has a 1.5px #7D1D17 border, and its label and
  number are #7D1D17 when the count is above 0.
- New **"Your move" strip** under the tiles: `--sidebar` fill, rounded-2xl. It reads "Your move: <n> documents
  are assigned to you." with a `--move-action` button "Open my work" → `/my-work`. Hide it when n = 0. This needs
  the assigned count. If the dashboard summary doesn't carry it, use the My work query's total.
- "Pending by division" and "Recent activity" keep their behaviour, with these style changes: Newsreader 26px
  headings, 8px bars on a `--border-subtle` track, and status pills with glyphs.

### Registry (`features/documents/registry-screen.tsx`, `components/dts/filter-bar.tsx`)

- Filter card (`--card`, rounded-2xl, p-4) has two rows:
  1. The Search input (filter size, `flex-1 min-w-[320px]`), then an **Advanced search** button: h-11, 1.5px
     `--primary` border, `--primary` text, a 16px sliders icon, a count badge (22px pill, `--primary` fill)
     showing the number of active filters (hidden at 0), and a chevron that rotates 180° while the panel is open.
     `aria-expanded` and `aria-controls` point at the panel.
  2. "Filtered by" and one active-filter chip per active filter, then "Clear all" (link style), then a spacer,
     then the Cards / Table / Lines segmented control.
- **Advanced search panel**: rendered under row 1 when open, with a 1px top border and pt-3.5. It holds Status,
  Priority, Type, Direction and Currently with as filter-size selects (`flex: 1 1 180px`, wrapping). An active
  select gets a `--seal` border and a `--seal-tint` fill. After the selects comes an **"Overdue only"**
  checkbox (20px box, row min-h-11, label 15px). When it's checked it shows as an "Overdue ×" chip and counts
  toward the badge. Footer, right-aligned: "Reset filters" (link) and "Show results" (primary, closes the panel).
- **Overdue filter** (new, needs API and contracts work):
  - Add an optional boolean `overdue` to the document list query in `packages/contracts`, and to
    `DocumentFilters` and the URL state in `apps/web/src/features/documents`.
  - In `apps/api/src/modules/documents/documents.repository.ts`, extract the predicate `summary()` already uses
    for the dashboard's Overdue count: status not in (RELEASED, ARCHIVED), `dueAt` is set, and `dueAt < now()`.
    Make it one shared expression and apply it to the list when `overdue=true`, so the tile and the list can
    never disagree.
- Filters still apply as they change (URL state, as today). "Show results" only closes the panel. The panel opens
  automatically if the page loads with no active filter chips but an empty result; otherwise it starts closed.
- Table columns: Document (title as a link, then the tracking number and type in a 12px tabular line, plus a
  lock icon if confidential), Status, Priority, Currently with, Direction, Registered. Keep server-side sorting.
- Below 760px the table becomes cards (this already exists via the `card` list view; make it the forced view
  under 760px). Card: tracking number and direction on top, title 16px/600, status and priority, then
  "With <division>".
- Pagination: "Showing [first]–[last] of [total]" on the left; Previous / Page x of y / Next (h-11) on the right.

### Audit trail (`features/audit/audit-screen.tsx`)

- Same pattern as the Registry, **without** a search field (the audit trail has no free-text search). Row 1:
  "Filtered by" and chips (for example "Dates: Oct 1 – Oct 7, 2026"), "Clear all", a spacer, then the Advanced
  search button.
- The panel holds Action, Actor, Outcome, From and To (date inputs per the Components table).
- The table keeps its columns. The selected row gets a `--seal-tint` fill and a 3px inset `--seal` left edge. The
  detail panel sits beside the table on wide screens (`flex: 1 1 300px`, 1.5px `--seal` border) and stacks below
  on narrow ones.

### My work (`features/documents/my-work-screen.tsx`)

The table becomes a **list** of rounded-2xl rows. Each row has:
- the status pill, priority, and a "tracking · type · direction" line
- the title as a 17px/600 link
- a "Your move: <next step>" line
- the target date on the right, #7D1D17 and with a 1px #7D1D17 row border when overdue
- an "Open" primary button (h-11)

The next-step copy comes from the actions available to the user. Use `action-labels.ts` and keep it in
lower-case sentence form, for example "accept custody into your division.". Keep the sort select (filter size).

### Document detail (`features/documents/document-detail-screen.tsx`)

- Add a sticky bottom **"Your move" bar** inside the content column: `--sidebar` fill, `py-3.5 px-6`, a
  sentence describing the next action, a secondary button, and a `--move-action` primary button. Hide it when the
  user has no available action. The buttons are the existing `document-actions` items, restyled.
- Header: an eyebrow line with tracking number, type and direction, then a Newsreader 40px title, with the
  status pill and urgent pill on the right.

### Forward dialog (`features/documents/route-dialog.tsx`)

Keep the copy and fields. Apply the Dialog spec and form-size fields. The "Copy in for information" list is a
1.5px-bordered box of 44px checkbox rows. Footer: "Cancel" (outline) and "Forward document" (primary), with a
1px top divider.

### Notifications sheet, command palette

- **Sheet:** right side, max-w-[440px], `--card`. Header has "Notifications" in Newsreader 28px, "[n] unread",
  "Mark all read" (link) and a 44px close button. Unread rows have a hoverRow fill, a 10px `--primary` dot and
  weight 700. Read rows have a ring-only dot.
- **Palette** (`cmdk`): max-w-[640px], 60px borderless input at 18px, group headings 12px/700 uppercase. The
  selected item has a `--sidebar` fill and `--sidebar-foreground` text, with its icon in `--seal`. Document rows
  show a tabular tracking number, the title (truncated) and a status pill. "Go to" items are rounded-full pills.

### Reports, Account requests, Users, Divisions, Sign in, Request account

Restyle only: apply tokens, field sizes, the table, card and dialog specs, and Newsreader titles. Remove the
admin sub-tab row from the boards; the sidebar covers it. Other per-screen details:

- **Reports:** Month and Year selects; "Excel (XLSX)" (outline) and "PDF" (primary) export buttons.
- **Account requests:** the queue on the left (selected row has a 2px `--primary` border) and the review panel on
  the right, with "Reject request" (outline destructive) and "Approve request".
- **Users:** a "Manage" button per row. Show the "Confidential" tag as a 1px `--seal` pill.
- **Divisions:** division codes in a 1.5px `--seal` box. Sections are listed indented under their division.
- **Sign in:** split layout. The left panel uses `--sidebar` with the Newsreader headline "Every handoff,
  accounted for."; the form is on the right.

## Responsive behaviour

| Breakpoint | Changes |
|---|---|
| ≥ 1024px (`lg`) | Sidebar visible (expanded or collapsed). Detail and audit side panels sit beside the main column. |
| 760–1023px | The sidebar becomes the existing sheet nav behind the header menu button. Side panels stack below. Filter fields wrap. |
| < 760px | Registry forces the card view. Dashboard tiles go to one column. Dialogs go full width with 16px margins. The "Your move" bar wraps its buttons to their own row, primary first and full width. |

## States and interactions

| Element | State | Behaviour |
|---|---|---|
| Primary button | Hover | `--primary-hover` |
| Primary button | Busy | Spinner and verb in progress ("Forwarding…"), disabled |
| Nav item | Hover | `--sidebar-accent` fill at 60% |
| Table row / list row | Hover | `--accent` fill |
| Advanced search | Open | `--muted` fill, chevron rotated, panel visible |
| Filter chip | Click | Removes that filter, focus moves to the next chip or to "Clear all" |
| Theme swatch | Click | Theme applies immediately, popover closes, focus returns to the palette button |
| Field | Focus | 2px `--ring` outline, 2px offset |
| Field | Error | See "Field error" |
| Any surface | Theme or mode change | 180ms colour transition (existing). None under `prefers-reduced-motion` |

## Edge cases

- **Counts:** design boards show `[n]`. Always render real counts with `toLocaleString()` in tabular figures.
  At 0, show "0", not a dash.
- **Long titles:** wrap to two lines in tables and cards, then truncate with an ellipsis. Command palette rows
  truncate to one line.
- **Long names** (sidebar footer, users table): truncate to one line with the full name in a `title` attribute.
- **Empty states:** keep the existing copy (`No documents match these filters`, `Nothing is assigned to you`, …).
- **Loading:** keep the existing skeletons, restyled to `--muted` with 12–16px radius.
- **Errors:** keep the existing alerts and their "Try again" actions.

## Accessibility

- Status pills and priority are text plus a glyph; colour is never the only signal.
- The palette button: `aria-label`, `aria-expanded`, `aria-controls`. Swatches: `aria-label` with the theme name
  and `aria-pressed`.
- The Advanced search button: `aria-expanded` and `aria-controls`. The panel is a labelled group. The count badge
  is announced as "<n> filters active".
- The active nav item has `aria-current="page"`. The underline is not the only signal; weight and fill change too.
- Every field has a visible `<label>` (already true).
- Focus order in the shell: brand, Search, nav items, palette button, notifications, collapse toggle.
- Check contrast (4.5:1 for text, 3:1 for the focus ring and borders that carry meaning) for all four themes in
  light and dark mode before shipping.

## Suggested implementation order

1. Tokens: the four theme blocks, the dark palette and the new variables in `theme.css`, registered in
   `@theme inline`.
2. Theme state: `theme-provider.tsx` (THEMES, `data-theme`, `dts.theme.v1`, migration), the boot script in
   `layout.tsx`, and the swatch popover in `theme-toggle.tsx`.
3. Fonts: Public Sans and Newsreader via `next/font/local`.
4. Primitives: the button, input, select, textarea and table sizes, and `StatusBadge` / `PriorityLabel` with
   glyphs.
5. Shell: sidebar restyle and footer.
6. Screens: Today, then Registry and Audit (Advanced search), then My work, then Detail ("Your move" bar), then
   the rest.
7. Update tests that assert accent names, `data-accent` or badge classes. Add tests for the theme migration, the
   Advanced search count badge, and that every dashboard tile is a link.

## Open questions

1. The overdue predicate excludes RELEASED and ARCHIVED but not COMPLIED, so a complied incoming document with a
   past due date counts as overdue. Should COMPLIED be excluded? This would change the dashboard count as well
   as the new filter.
2. Does the "Your move" strip on Today need a new field on the dashboard summary, or should it reuse the My work
   query? Current plan: reuse My work's total.

## Decisions log

- 2026-10-08: collapsing the sidebar at `lg+` moves search into a top bar over the content column, and the collapsed
  rail drops its Search button. Ctrl/⌘B toggles the sidebar when focus is not in a text field.
- 2026-10-08: contrast fix. In the light pastels, primary, sidebar-seal and input are darkened; input is adjusted in
  all eight theme and mode blocks so field borders reach 3:1. Each change moves lightness only, so hues are unchanged.

- 2026-10-07: add an `overdue` list filter, and link the dashboard's Overdue tile to it.
- 2026-10-07: each theme gets its own dark palette, replacing the single shared dark palette.
