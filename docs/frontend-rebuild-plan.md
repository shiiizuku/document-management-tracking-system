# Frontend rebuild on shadcn/ui — plan

_Agreed 2026-10-01. Task-level backlog: `docs/IMPLEMENTATION_STATUS.md` → **M7 · Frontend rebuild**._

**Status: F0, F1 and F2 are done.** `DtsApp` and `globals.css` are gone; every screen below is on
shadcn, routed, and served by the domain query modules. What remains is the ⌘K command palette under
**Later**, plus the Phase 7 QA sweeps that decision 8 deferred.

The UI this replaced (PRs #50–#56) worked but lived in one 735-line client component (`DtsApp`)
styled by a 1,198-line bespoke `globals.css`. It could not absorb the remaining surfaces (admin,
audit, dashboard) and had no routes. This plan replaces it, in phases, with a routed App Router app
on shadcn/ui.

## Decisions

| #   | Decision                                                                                              | Why                                                                         |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | **Full rebuild, phased** — every screen moves to shadcn                                               | One visual language; `DtsApp` is the wrong shape to grow                    |
| 2   | **Bespoke styled layer** on shadcn primitives; brand ported into shadcn CSS variables                  | Keep the pilot identity (seal, login story, palette), not the shadcn default |
| 3   | **TanStack Query** over the existing `api()` transport                                                 | One home for loading/error/refetch/invalidation instead of per-screen code  |
| 4   | **App Router routes + shared layout**                                                                  | Deep links, bookmarks, a working back button, per-route code-splitting      |
| 5   | **react-hook-form + zod**, resolving the `@dts/contracts` schemas                                      | Client and API validate with the same schema                                |
| 6   | **Parity rebuild first, then new surfaces**                                                            | Re-skin known-good behaviour while proving the foundation; UI stays single-language |
| 7   | **sonner toasts + skeletons** as the app-wide feedback convention                                      | D-111: toasts are immediate feedback; notifications stay the durable record |
| 8   | **Heavy QA deferred to Phase 7** (axe sweep, responsive/browser matrix, Playwright E2E)               | Radix gives baseline keyboard/focus/labels; a thin per-route test net stays |

Tailwind v4 (the current shadcn default for Next 16 / React 19). Everything lives in `apps/web` — a
`packages/ui` seam would have one consumer, so it would be hypothetical.

## Module design

Each module below puts a lot of behaviour behind a small interface; screens stay thin.

| Module                                                                                       | Interface                                                                   | What it hides                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`lib/api.ts`** (transport)                                                                 | `api<T>(path, init)` → `T` or throws `ApiError`; `download(path, filename)` | Credentials, the CSRF double-submit header, the `{ data }` / `{ error }` envelope, binary responses. The **one** seam tests replace.                                                         |
| **`ApiError`**                                                                               | `{ status, code, message, details?, correlationId? }`                       | Lets callers tell a 409 conflict from a 403 or a field error without parsing messages. Today it keeps only `message` + `status`.                                                              |
| **Domain query modules** — `features/{documents,notifications,org,admin,audit,reports,dashboard}/queries.ts` | Hooks: `useDocuments(filters, page)`, `useDocument(id)`, `useRunAction(id)`, … | Each module owns its query-key factory **and** its invalidation. Screens and the realtime adapter never see a key, so a cache-key change touches one file (no information leakage).        |
| **Realtime adapter** — `useRealtimeSync()`, mounted once in the `(app)` layout               | none                                                                        | The socket and its event names. On an event it invalidates notifications and the affected document through the domain modules.                                                             |
| **Session gate** — `useSession()`, `<RequireCapability cap>`                                 | session + capability check                                                  | Reads the `capabilities[]` that `/auth/me` already returns, so the client never derives authority from `role`. A 401 anywhere clears the cache and redirects to `/login?next=…`.              |
| **`components/ui/*`**                                                                        | shadcn components                                                           | The copied components are owned code: **the brand styling goes into them directly**. No wrapper-per-component — that would be a shallow pass-through layer.                                |
| **`components/dts/*`**                                                                       | `DataTable`, `FilterBar`, `DocumentActions`, `StatusBadge`, `PageHeader`, `EmptyState` | `DataTable` does server pagination/sort once for registry, users, account requests and audit (four callers). `DocumentActions` renders the server's `allowedActions` and opens a dialog per action that needs input (remarks, release method) — replacing `window.prompt`. |

**Forms:** `zodResolver(<contracts schema>)` plus one helper, `applyServerErrors(form, apiError)`, that
maps server field details back onto the form fields.

**Known, accepted leak:** `DocumentActions` must know which actions need a dialog, and the same rule
lives in `WorkflowService`. That is acceptable because the server still validates and has the final say.

## Routes

```
(public)  /login  /request-account
(app)     /dashboard
          /documents            ← filters + page in search params
          /documents/[id]
          /my-work              ← GET /documents/assigned
          /reports
          /audit                ← user/action/from/to in search params
          /admin/requests  /admin/users  /admin/organization
```

Notifications stay a sheet opened from the layout, not a route.

## Phases

### F0 — Foundation

- **Style-isolation spike first.** Tailwind's preflight reset collides with `globals.css`. Before
  migrating any screen, render one shadcn page beside the old CSS and fix the isolation strategy
  (e.g. scope the old sheet under a wrapper class) so F1 can move screen by screen.
- Install Tailwind v4 + shadcn (`components.json`); port palette, type scale and radii into the shadcn
  CSS variables.
- `QueryClientProvider` (global 401 handling), sonner `<Toaster>`, `ApiError` + `download()`.
- `(public)` / `(app)` route groups; session gate; sidebar + topbar; capability-filtered nav.
- `DataTable`, `FilterBar`, `PageHeader`, `EmptyState`, skeletons.
- Export capability names from `@dts/contracts` so nav gating and the API share one list.

### F1 — Parity rebuild

1. `/login` — **seeded credentials prefilled only in development builds** (they are prefilled
   unconditionally today; decision 100 forbids reusing them in the pilot).
2. `/documents` — `DataTable` + `FilterBar`, state in the URL.
3. `/documents/[id]` — metadata, timeline, `DocumentActions` with dialogs, edit metadata, forward/route.
   A 409 refetches the document and shows "This document changed — review and retry".
4. Attachments — upload, per-version scan badges, scan-gated download through `download()`.
5. Notifications sheet + `useRealtimeSync()`; mark-read updates optimistically and rolls back on failure.
6. `/reports` — month view and XLSX/PDF export through `download()`.
7. **Retire** `dts-app.tsx` and `globals.css`.

### F2 — New surfaces _(done)_

1. `/dashboard` — needed **two small backend additions**, both landed: pending counts per division
   computed with the same `documentScopeFor` predicate, and a scoped recent-activity feed from
   `workflow_events`.
2. `/my-work` — the assigned-to-me queue over `GET /documents/assigned`.
3. `/audit` — viewer with user/action/date filters in the URL, over `GET admin/audit-events`.
4. `/admin/requests`, `/admin/users`, `/admin/organization`.
5. `/request-account`.
6. Delete/restore controls (capability-gated); routing-slip download.
7. Inline preview, for `CLEAN` PDFs and images only.

**Three backend additions F2 turned out to need**, beyond the two the plan anticipated for the
dashboard. Each is noted here because the plan said the remaining endpoints already existed:

- `GET /documents/attachments/:versionId/content` — the inline variant the plan called for (item 7).
  `inline` disposition, `nosniff`, a `default-src 'none' … sandbox` CSP, `private, no-store`, and its
  own audit action (`attachment.previewed`): reading a document on screen and taking a copy away are
  different events. It shares one fail-closed read path with the download, so the quarantine check
  cannot be present on one route and missing from the other.
- `GET /documents/deleted` — a scoped list of soft-deleted documents, filtered per row by the same
  `DOCUMENT_RESTORE` predicate `restore()` applies. Item 6 needed it: a deleted row is invisible to
  every other read, and `POST /documents/:id/restore` requires its current `version`, so without this
  list the restore endpoint has no reachable caller.
- `GET /audit-events` now answers `{ items, total, limit, offset }` instead of a bare array. An audit
  viewer that cannot say whether it is showing everything or the first page is worse than one that
  refuses to answer, and it matches the registry's page shape so both lists drive one `DataTable`.

### Later (after F2)

- ⌘K command palette (shadcn `Command`): jump to a tracking number, run allowed actions. Satisfies
  D-99's "discoverable" keyboard-shortcut requirement.

### Testing

Each route ships with a thin component-test net: replace `api()` (the one transport seam), drive the
domain hooks, and cover loading / empty / error / success. The axe sweep, the responsive/browser
matrix and Playwright E2E stay in Phase 7.
