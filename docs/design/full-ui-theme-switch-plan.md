# Full shadcn/ui and Material 3 Expressive switch — implementation plan

**Status:** Initial app-wide switch implemented; route-by-route visual review remains

**Scope:** DTS web client (`apps/web`)  
**Outcome:** A user can switch the entire web UI between shadcn/ui and Google's Material 3 Expressive (M3 Expressive), independently of light, dark, or system color mode.

**Implementation note:** The current switch uses system-specific tokens and component treatments
selected by `data-design-system` on `<html>`. Both modes share React and Radix behavior to keep
forms, focus, and workflow state mounted during a switch. The remaining review is visual and
interaction parity on authenticated routes and overlays against live data; the public pages have
been browser checked.

## What “full switch” means

The selection changes component shape, structure, typography, spacing, color roles, motion, state treatment, navigation, tables, forms, and overlays. It is not a CSS palette swap or a return to the older MD3 skin. The same routes, records, validation, permissions, API operations, and workflow outcomes remain available in both systems. A shadcn control must not appear in the M3 Expressive interface except where a browser-native control is intentionally shared (for example, the file picker); the converse also applies.

The first release covers every production route and global surface. `/ui-draft` is a read-only concept that follows the selected appearance; it does not submit workflow actions. Both systems support light, dark, and system color mode. The initial M3 Expressive palette uses the project's existing sage identity; accent and density customization from the retired MD3 appearance UI are **not** part of this first switch unless separately approved. “Full” means full coverage of components the application actually uses, not adding every component in Google's catalog without a product use.

## Current baseline and constraints

- Next.js App Router, React, Tailwind v4, owned shadcn/Radix files in `src/components/ui`, and DTS compositions in `src/components/dts`.
- `app/layout.tsx` mounts `AppProviders` once, preserving the query cache across routes. `(app)/layout.tsx` owns the session gate. `AppShell` owns navigation, notifications, and the command palette.
- The working tree already contains an uncommitted light/dark `ThemeProvider`, `ThemeToggle`, and shadcn token update. It also removes the older `md3-theme.css`, appearance controls, and Tailwind config. Treat these as user work: inspect the latest diff at implementation time and build on it without resetting or restoring files over it.
- Git history contains an older MD3 token and appearance implementation. `docs/design/md3-shadcn-bridge.md` records useful roles and interaction guidance, but describes a *shared shadcn/Radix component set* and predates this M3 Expressive request. This plan requires two component implementations, so the bridge is reference material, not the target architecture. Update or supersede that document when implementation lands.
- Existing screens import directly from `components/ui` and use many Tailwind classes. Controls alone cannot deliver a full switch: shell, list views, status displays, loading and error states, and route composition also need M3 Expressive presentation.
- The official `@material/web` repository says it is in maintenance mode. Do not make it a required runtime dependency without a separate compatibility and maintenance decision. Prefer owned React M3 Expressive components using existing accessible primitives where useful. These must be distinct renderers, not shadcn renderers with new colors. See [Material Web's project status](https://github.com/material-components/material-web) and the [current Material design specification](https://m3.material.io/).

## Architecture

### 1. Two independent preferences

Keep the current color-mode preference (`light | dark | system`) and add a validated design-system preference (`shadcn | md3`). Default existing users to `shadcn`, so the new feature does not silently change their interface. Store the design choice per browser, using a new versioned local-storage key. A storage failure keeps the in-session choice; an invalid value falls back to shadcn. No API or account schema change is needed.

Extend the existing provider rather than mounting another query or session provider. Apply `data-design-system="shadcn|md3"` to `<html>` and retain the `.dark` class for color mode. Extend the existing pre-hydration script to set both before first paint. The script must validate storage values and use fixed attribute values. Scope system tokens and global CSS to the root attribute, including portal content mounted under `<body>`. Avoid CSS rules that allow one system's base styles to leak into the other.

Put a labeled design-system selector beside the current light/dark control in the desktop sidebar and mobile navigation. Expose both choices clearly; announce the selected choice to assistive technology. Keep keyboard access and visible focus in both implementations. Switching must not trigger a route change, query-cache reset, session probe, or duplicate realtime subscription.

### 2. Shared behavior, separate rendering

Keep domain queries, API transport, URL filter/page state, capability checks, React Hook Form/Zod schemas, mutation and invalidation logic, and realtime behavior outside the design-system boundary. Define a small shared UI contract only where two implementations really need the same props. Preserve current public import paths initially so migration can be incremental.

Keep the owned React/Radix behavior and use the root design-system attribute to select complete component treatments. This avoids remounting forms, dialogs, inputs and workflow state when the user switches designs. Compound components (Dialog, Select, DropdownMenu, Sheet, Form) still need visual and interaction review as complete subtrees, including portals, refs, `asChild` behavior, controlled state, and form registration. Extract a separate renderer only where the M3 Expressive structure truly differs; do not create thin wrappers merely to hide filenames.

For larger DTS compositions, use the same shared component with system-specific treatments where the layout can retain its structure. Examples are `AppShell`, `DataTable`, `FilterBar`, `DocumentCards`/`DocumentLines`, `PageHeader`, `EmptyState`, status and priority indicators, and skeletons. Split a screen's data and actions from presentation only when a different structure is necessary; do not duplicate queries and mutation handlers across two full screen files. Preserve document links, sort semantics, pagination, list-view preference, filtering, and server-authorized actions.

### 3. M3 Expressive foundations and component mapping

Create an M3 Expressive token layer for light and dark: primary, secondary, tertiary, error, surface/container, on-colors, outline, contrasting and adaptable shapes, flexible type scale, elevation, state layers, and current motion guidance. Map DTS workflow statuses and priorities to explicit readable roles, with text and icons where needed so color is not the sole signal. Keep the brand seal and product naming; do not import vendor branding. Google's [current Material overview](https://m3.material.io/) identifies vibrant color, intuitive motion, adaptive components, flexible typography, and contrasting shapes as M3 Expressive foundations. Use these to clarify actions and hierarchy in a dense records interface; Google's [research guidance](https://design.google/library/expressive-material-design-google-research) also calls for tailoring expression to critical user journeys and preserving accessibility.

Build a small M3 Expressive reference screen before migrating routes: desktop registry, mobile document list, and a registration dialog. Specify color roles, type, shape contrast, navigation, prominent action, hover/pressed/focus states, and entrance/exit motion in both light and dark. Review it against Google's current component guidance rather than assuming the historical `md3-theme.css` matches M3 Expressive. Record intentional adaptations for dense tables and government-records content.

| Existing surface | M3 Expressive counterpart / acceptance focus |
| --- | --- |
| Button, icon button, link action | Current expressive filled, tonal, outlined, text, and icon button patterns; button groups or split buttons where they improve related actions; disabled, pending, destructive and focus states |
| Input, textarea, select, checkbox, switch, label, form | M3 Expressive field and selection patterns; React Hook Form wiring, field errors, helper text, required/disabled states |
| Dialog, sheet, popover, menu, tooltip, command palette | Expressive containers, actions and motion; correct focus trap/return, Escape, scroll lock, portal colors |
| Card, badge, alert, separator, avatar, skeleton | Expressive surfaces and status treatment; progress indicators where waiting is meaningful; loading, empty and error parity |
| Table and document card/line views | Expressive data presentation with the same links, sorts, pagination, selection and responsive behavior |
| Navigation shell and notification panel | Expressive navigation rail/drawer, top bar and toolbar patterns at desktop and mobile widths |

Use the current M3 Expressive specification as the visual and interaction reference. Reuse Radix where it supplies behavior that fits the pattern; the rendered component and its styling must still meet the expressive design. Google's current catalog includes newer toolbars, split buttons, button groups, expanded shapes, and motion physics; use them where they fit DTS tasks rather than decorating every control. A brief spike on Button, text field, Dialog and Select must prove the approach, including React 19, Next server rendering, hydration, forms, focus, and portals, before expanding the component set.

## Coverage inventory and migration order

The production coverage gate includes every route below, plus global overlays and every loading, empty, error, success and disabled state. Capability-dependent views need test accounts with relevant permissions.

| Wave | Routes / surfaces | Why this order |
| --- | --- | --- |
| 0 — Baseline | Current diff, screenshot and interaction inventory; tokens; switch state; component spike | Prove isolation and avoid losing ongoing work |
| 1 — Public and shell | `/login`, `/request-account`, session loading/unavailable, desktop/mobile shell, account menu, notifications, command palette | Establish preference access and navigation before migrating data screens |
| 2 — Read paths | `/dashboard`, `/documents`, `/documents/[id]`, `/my-work` | Exercise expressive information hierarchy, cards, table/card/line lists, filters, metadata and status views |
| 3 — Write paths | Registration, metadata, route/action, delete/restore, attachment upload/preview, routing slip and reference dialogs | Exercise validation, pending state, error recovery and unsaved input |
| 4 — Administration and reporting | `/reports`, `/audit`, `/admin/requests`, `/admin/users`, `/admin/organization` | Cover all remaining production routes, tables and privilege-dependent actions |
| 5 — Hardening | Responsive, browser, accessibility and visual regression pass; docs and cleanup | Make both systems releasable together |

Track the inventory in a checklist during implementation: each route and overlay must be marked complete in both color modes and at desktop and mobile widths. A wave is complete only when its shadcn and M3 Expressive versions have equivalent accessible actions and pass targeted tests. Keep the user-facing switch behind a local development flag until every production row is complete; do not expose a half-migrated mode.

## State and switching behavior

- The choice is local to the browser and survives reloads and route navigation; `system` continues to follow OS color changes in either design system.
- Prefer style changes in place for shared controls. Where swapping component trees remounts a view, keep form and overlay state above the renderer. Do not silently discard unsaved text, a selected upload, or an in-progress mutation. If a specific workflow cannot preserve a draft, block the switch while it is active and give a clear explanation; record that exception in the coverage inventory.
- On a switch with no active edit, preserve the route, search parameters, scroll position where practical, table page/sort, selected list view, and query cache. Return focus to the selector after an overlay closes. Honor reduced-motion preferences.
- A design-system choice is presentation state, not an authorization input. All actions continue to use server-provided capabilities and server validation.

## Verification and release gates

1. **Provider tests:** persisted, absent, invalid and unavailable storage; legacy color preference; system mode changes; two axes remain independent; pre-hydration script and hydrated provider agree.
2. **Component contract tests:** important variants and ref/form behavior in both systems. Test dialogs, selects, menus and sheets with keyboard input, focus restoration, controlled state, and portal content.
3. **Screen tests:** run existing feature tests under both design-system preferences where markup permits; add focused tests for layout differences and critical actions. Do not weaken behavioral assertions to make a renderer pass.
4. **Browser tests:** extend Playwright smoke and workflow tests to cover the preference switch on a live route, reload persistence, navigation, registration/route actions, and an open form. Run axe against representative public, app, dialog, table and admin states in each system and color mode. Check desktop and narrow mobile widths, zoom, and reduced motion.
5. **Build gates:** `npm run build -w @dts/contracts`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Run the existing E2E/axe suite against the built stack where infrastructure is available. Compare bundle size and first paint against the shadcn baseline; lazy-load M3 Expressive code if both systems substantially increase the initial bundle.
6. **Release gate:** no mixed-system production surface, no regression in permissions or workflow effects, no known keyboard/focus or critical contrast defect, no unsaved-data loss on switch, and no flash of the wrong system on reload. Update design documentation and mark the old bridge as historical or revise it to describe the two implementations.

## Main risks and responses

| Risk | Response |
| --- | --- |
| Existing uncommitted theme changes conflict with historical MD3 files | Treat the working tree as the baseline; restore no deleted file wholesale; port only needed tokens and behavior into new namespaced files |
| One screen renders shadcn controls inside M3 Expressive chrome | Inventory all direct `components/ui` imports and hard-coded utility classes; gate release on route/overlay review and screenshots |
| Compound controls differ in event or ref behavior | Prototype the difficult contracts first and test them with real forms and keyboard input |
| Switching remounts a dirty dialog or upload | Hoist state or block the switch with a specific explanation until the edit completes |
| Two systems increase maintenance and bundle size | Keep domain behavior single-source, avoid parallel query code, and split presentation bundles at the design-system boundary |
| Color, shape, type, state, or motion falls back to older MD3 patterns | Use current M3 Expressive guidance as explicit review criteria, including dark mode, adaptive layout and reduced motion |

## Decisions to record before implementation

1. **Confirmed by request:** The switch selects complete shadcn and Google's Material 3 Expressive component experiences; light/dark is independent.
2. **Proposed default:** Existing users stay on shadcn; design preference is per browser.
3. **M3 Expressive implementation:** Owned component treatments on existing React/Radix behavior, because the official Material Web package is in maintenance mode and the current app is already React/Radix based. Introduce separate structural renderers only for patterns that require them.
4. **Open product choice:** Whether to restore older MD3 accent and density controls later. They are excluded from the first release so that the requested two-system switch has a clear completion boundary.

