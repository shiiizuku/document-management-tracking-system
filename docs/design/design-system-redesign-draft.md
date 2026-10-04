# DTS design system redesign — draft

**Status:** Proposal for review · **Branch:** `codex/design-system-redesign-draft` · **Scope:** Web client

This is a proposal for the Document Management and Tracking System (DTS), with a [static registry
preview](./redesign-preview.html) and a [desktop image](./redesign-preview.png). It does not change
the running UI. The sample records in the
preview are fictional. The existing [Material 3 and shadcn bridge](./md3-shadcn-bridge.md) remains
the implementation baseline until this proposal is accepted.

## Design direction

**A calm records workspace.** The document, its custody, and the next authorized action should be
easier to see than the chrome around them. Keep the existing sage identity, Inter typeface, semantic
Material 3 color roles, Radix behavior, and user appearance preferences. Make the application feel
more coherent through clearer information hierarchy, quieter surfaces, and explicit task patterns.

The five reference systems contribute distinct ideas; this is a synthesis for a browser based,
data heavy government workflow, not a copy of any vendor's visual identity or component package.

| Reference | Principle used in DTS | Where it appears in the draft |
| --- | --- | --- |
| [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/foundations) | Clear hierarchy, legible content, controls near what they affect | Stable page titles, restrained chrome, local actions beside document context |
| [Material Design 3](https://m3.material.io/foundations/) | Semantic color, interaction states, adaptable tokens | Retain current tonal roles and state layers; use surface levels to group work |
| [Atlassian Design System](https://atlassian.design/foundations/tokens) | Tokens as shared design decisions | Name workflow and content roles once; document component usage and migration |
| [Fluent 2](https://fluent2.microsoft.design/design-tokens) | Global values behind semantic aliases, theme flexibility | Separate palette seeds from page and workflow roles; audit light and dark together |
| [eBay Evo](https://playbook.ebay.com/foundations/accessibility) | Accessible, predictable browsing of many items | Strong search and filter affordances, visible labels, focus, and text with status color |

These references inform decisions, not dependencies. No Apple, Google, Atlassian, Microsoft, or eBay
component library, icon set, asset, or brand color is proposed for import.

## What exists now

The client already has a meaningful system. `apps/web/app/md3-theme.css` owns tonal palettes,
semantic roles, status signals, type, shape, motion, accent presets, and three density modes.
`theme.css` supplies the base styles. `tailwind.config.js` mirrors tokens for tooling.
`components/ui` uses owned shadcn/Radix primitives, while `components/dts` provides the app shell,
page header, filter bar, list shell, data table, and workflow labels. The document registry has
table, card, and line views; its filters and page live in the URL, while list view is a device
preference. The API determines document scope and allowed actions.

The redesign should therefore focus on how these pieces compose. A wholesale theme replacement
would risk breaking existing accent, dark mode, density, keyboard, and authorization behavior.

### Specific opportunities observed in the current UI code

1. `PageHeader` supplies a consistent title but has no breadcrumb or secondary context slot. The
   document detail screen builds its own return link and metadata hierarchy.
2. `FilterBar` and `DocumentList` are reusable, but the registry puts many filters at equal visual
   weight. The default scan path should be search → active filters → results; advanced filters can
   remain available without dominating the page.
3. Status and priority use shared mappings, but `StatusBadge` and `PriorityLabel` render at 10px.
   The redesign should test larger labels and preserve the text signal at every density.
4. `DataTable` places click and keyboard behavior on table rows. The accepted version should use an
   explicit record link for predictable screen reader and keyboard semantics while keeping sorting,
   pagination, and row selection discoverable.
5. The theme already has six shape stops and three density settings. New page patterns should use
   those tokens instead of adding another independent spacing or radius scale.

## Proposed foundations

### 1. Content and hierarchy

- One page title (`h1`) names the task or record. Use the existing `PageHeader` as the shared seam.
- Place a short context line below the title only when it helps answer *which records am I seeing?*
  or *whose work is this?* Counts are secondary and use tabular numerals.
- Give each page one emphasized action. Keep other actions in an adjacent secondary group or in a
  clearly labeled menu; destructive actions stay visually distinct and require the existing
  confirmation flow.
- In detail views, lead with the tracking number, title, status, current custodian, and next allowed
  action. Put long metadata and audit history below. Do not infer allowed actions from role on the
  client; continue to render the server's `allowedActions`.
- Preserve plain language such as “Currently with” for custody and “Registered by” for origin.
  These are different facts in the existing workflow.

### 2. Semantic token contract

Keep `--md-*` as the color and motion engine and the existing shadcn aliases for shared controls.
Introduce a **small DTS semantic alias layer** only when a domain meaning has more than one caller.
The following names are proposed, not yet implemented:

| Proposed alias | Maps to existing role or token | Intended use |
| --- | --- | --- |
| `--dts-page-surface` | `--md-surface-container-low` | Main canvas |
| `--dts-panel-surface` | `--md-surface-container-high` | Grouped content, lists, forms |
| `--dts-panel-border` | `--md-outline-variant` | Quiet separators and panel edges |
| `--dts-control-border` | `--md-outline` | Interactive inputs and outlined buttons |
| `--dts-text-primary` | `--md-on-surface` | Titles and body content |
| `--dts-text-secondary` | `--md-on-surface-variant` | Supporting metadata |
| `--dts-action-primary` | `--md-primary` | Primary action and selected navigation |
| `--dts-focus` | `--md-primary` | Existing global visible focus treatment |

Keep workflow signals (`wait`, `move`, `done`, `closed`) and urgent/high priority independent of the
user's accent choice. Status must always include text. In implementation, the alias layer belongs in
`md3-theme.css`; any new Tailwind utility must be mirrored in `tailwind.config.js` and checked in
`src/lib/utils.ts` if `tailwind-merge` needs to recognize it. Avoid component specific hex values.

### 3. Typography, spacing, shape, motion

- Keep Inter and the existing Material 3 type roles. Prefer `headline-small` for page titles,
  `title-medium` for panel titles, `body-medium` for content, and `label-large` for controls. The
  final size choice needs browser review at 200% zoom and all densities.
- Keep the existing spacing and density tokens. Default density should favor comfortable reading;
  compact and minimal may reduce whitespace, but never shrink the type scale or meaningful target
  area. Mobile touch targets should aim for 44px even when a desktop density is minimal.
- Use the existing shape scale: medium for inputs and panels, large for cards, full for badges and
  the current button treatment. Keep the number of visibly different shapes low on one screen.
- Use existing MD3 duration and easing tokens for state feedback and overlays. Preserve reduced
  motion behavior. No decorative animation is needed for the registry or timeline.

### 4. Accessibility and resilience

Target WCAG 2.2 AA in the eventual implementation. Validate text, icons, borders, focus, disabled
states, and every status pair in light and dark across all accent presets. Keep labels visible for
search and filters, with error messages next to the relevant field. A list must make loading,
empty, stale, error, and success states clear without a color only cue. Preserve keyboard order,
focus return after dialogs, a sensible heading structure, and readable layout at 320px and 200%
zoom. The static preview is illustrative and is **not** accessibility evidence for the app.

## Proposed component rules

| Component / pattern | Draft rule | Existing implementation seam |
| --- | --- | --- |
| App shell | Quiet sidebar, clear active item, search and notifications in predictable locations; preserve capability filtered navigation | `components/dts/app-shell.tsx`, `nav-items.ts` |
| Page header | Title and context first, primary action aligned with title; optional breadcrumb for detail pages | `components/dts/page-header.tsx` |
| Filters | Search stays visible. Show active filter count and removable chips; put less used filters in a labeled disclosure on narrow screens | `components/dts/filter-bar.tsx`, registry URL state |
| Record list | Keep table/card/line options. The entire record remains easy to open, with an explicit title link and separate selection semantics | `components/dts/data-table.tsx`, `features/documents/document-list.tsx` |
| Status | Human readable word plus fixed signal color. Never use priority color as a substitute for status | `components/dts/status-badge.tsx` |
| Document detail | Summary strip for tracking, status, custody, priority, and next action; metadata, attachments, and timeline stay distinct | `features/documents/document-detail-screen.tsx` |
| Feedback | Keep retry and correlation ID for errors, stable skeleton geometry, and durable notifications separate from transient toasts | `list-shell.tsx`, `empty-state.tsx`, notification and toast components |

## Screen concept: document registry

The [preview](./redesign-preview.html) shows a desktop registry and a mobile reflow. Its samples are
fictional and its controls are illustrative. It uses restrained sage, a quiet neutral canvas,
stronger title and search hierarchy, compact but legible record summaries, and text labeled status.

The real registry must retain URL based filters, server pagination and sorting, the per device list
view preference, capability gated creation and restore controls, and confidential record policy.
The preview deliberately makes no network request and includes no real document metadata.

## Implementation sequence after approval

1. **Token and accessibility baseline.** Add only the accepted DTS aliases. Capture contrast,
   focus, zoom, and density checks for light/dark and all accent presets. Keep the existing MD3
   bridge as the source of truth.
2. **Shared patterns.** Update `PageHeader`, `FilterBar`, status labels, and record link semantics
   with focused tests. Preserve their public props where practical and update tests when behavior
   changes.
3. **Pilot registry.** Apply the composition to `/documents` first. Verify query state, sorting,
   pagination, table/card/line views, empty and error states, permissions, keyboard navigation, and
   narrow layouts.
4. **Detail and adjacent screens.** Carry the same hierarchy into document detail and My work,
   then review dashboard, reports, audit, and administration for consistency without altering their
   workflow or access rules.
5. **Documentation and release.** Update the MD3 bridge guide to distinguish existing tokens from
   accepted DTS aliases, and run visual and accessibility QA before any merge.

### Acceptance criteria for the implementation

- A user can identify the record, status, current custodian, and next allowed action without
  searching through secondary metadata.
- Search, filtering, pagination, sorting, list views, and deep links behave as they do now.
- All controls and states are usable by keyboard and at 320px and 200% zoom; no horizontal page
  overflow. Theme, accent, and density combinations remain functional.
- No hardcoded status or page colors enter route components. No capability or workflow rule moves
  from the server to presentation code.
- Focused component tests and a browser based visual/accessibility review pass for the pilot before
  applying it to the remaining screens.

## Review decisions

1. Is the registry the right pilot screen, or should My work lead because it is more task oriented?
2. Should desktop default to the current table view or the proposed richer row summary? Both can
   use the same `DocumentList` interface; the choice affects the initial visual density.
3. How prominently should current custody appear for users whose work is mostly registration rather
   than routing? Validate with actual operators before making it the dominant registry column.
