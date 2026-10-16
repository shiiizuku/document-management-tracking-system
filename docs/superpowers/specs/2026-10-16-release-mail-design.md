# Release mail: design

_2026-10-16. Branch `feat/release-mail`._

## Purpose

When an outgoing document reaches `FOR_RELEASE`, staff email the addressee a Gmail-style message
carrying the signed PDF, review it first, and the system records delivery. Today a release by
"Emailed" records a method and nothing is sent; staff attach the PDF in their own mail client.

**Success:** from the For Release screen a releaser opens a pre-filled Compose dialog, edits it, sends
it, and sees Sent or Failed (with Resend) on the document. A failed SMTP server never blocks a
release.

**Constraints (stated by the user):** delivery over the agency's own SMTP server; the user reviews
before anything is sent; the attachment is the signed PDF only.

**Out of scope:** Gmail API/OAuth, inbound mail or reply threading, bounce processing, free choice of
attachments, mail for incoming documents' own receipt.

## Who is mailed

Two cases, one mechanism. The draft is created when an outgoing document enters `FOR_RELEASE`:

1. **Outgoing document addressed to a client or proponent**: the emails on its `recipients`
   (`DocumentRecipient.emails`).
2. **Request logged against an incoming document**: for each incoming document linked to the outgoing
   one through `document_references`, its contact `documents.email` (the requester). Staff never
   retype it; it is added to **To** when present.

Addresses are de-duplicated case-insensitively. A draft with no address is still created, empty
**To**, so the releaser fills it in or skips it.

## Approach

Outbox plus worker (existing `outbox_events`, `outbox-relay`, `worker`). The Send action writes the
`mail_messages` status change and an outbox event in one transaction; the worker delivers it over SMTP
and records the result. Chosen over sending inside the request (an SMTP outage would fail or stall a
release) and over the Gmail API (declined).

## Data

New table `mail_messages` (Drizzle migration):

| column | notes |
| --- | --- |
| `id`, `document_id` | FK `documents`; many messages per document (resends) |
| `to_addresses`, `cc_addresses`, `bcc_addresses` | `text[]`, lower-cased, max 20 each |
| `subject`, `body` | `body` is plain text, sent as plain text (no server-rendered HTML; amended) |
| `file_version_id` | FK `file_versions`; the signed PDF, fixed at draft time |
| `status` | `DRAFT`, `QUEUED`, `SENT`, `FAILED` |
| `attempts`, `last_error`, `smtp_message_id`, `sent_at` | delivery result |
| `created_by_id`, `sent_by_id`, timestamps | |

Resend creates a new row copied from the failed or sent one, so history is never overwritten.

## Behaviour

- **Draft:** `PREPARE_RELEASE` creates one `DRAFT` (idempotency key `mail.draft:<documentId>`).
  Subject: `<reference number>: <title>`. Body from a template in `office_settings` (editable by
  administrators; default text shipped). Attachment: the signed file version recorded by the document's
  `signature_events` row. If it is missing, no draft is created and the screen says why.
  _Amended:_ likewise when that version is not `application/pdf` (the workflow does not require a
  PDF at SIGN or PREPARE_RELEASE); the worker also fails a non-PDF with "The signed file is not a PDF".
- **Compose:** `GET/PATCH /documents/:id/mail/:mailId` edits `DRAFT` only. `POST .../send` validates
  addresses (zod email, at least one **To**), moves to `QUEUED`, writes the outbox event
  `mail.send:<mailId>`. _Amended:_ each message exposes a `revision` (hash of To, Cc, Bcc, subject
  and body; no column); send takes `{ revision }` and answers 409 `MAIL_CHANGED` when the stored
  draft no longer matches, and `markQueued` is conditional on the `updated_at` read in the same
  call. A skipped draft is locked: edit and send answer 409 `MAIL_SKIPPED`. The mutations sit
  behind `CsrfGuard`.
- **Delivery:** the worker loads the PDF from storage, sends through the `MailSender` port, sets
  `SENT` with `smtp_message_id`, or `FAILED` after 8 attempts with exponential backoff from 30 s
  (about an hour; amended from the queue default of 5 from 1 s). Attachment must be clean-scanned;
  otherwise `FAILED` with that reason. _Amended:_ `SENT`/`FAILED` commit in one transaction with
  their audit row; a partial SMTP rejection (`info.rejected` non-empty) is `FAILED` at once with
  counts only and is not retried.
- **Release interplay:** `RELEASE` with an "Emailed" method requires a `SENT` message for the
  document, or an explicit skip with a remark (`mail.skipped`, audited). Other methods ignore mail.
  This guard lives in `WorkflowService` beside the other release preconditions. _Amended:_ the guard
  applies only when a message exists; a document with none (no signed version at prepare time, or
  already For release when this shipped) releases by Emailed freely. Skip marks the newest unsent
  message (Draft, Queued or Failed) and is refused once one is Sent. A draft is sent only while the
  document is For release; resend is allowed in any status.
- **Permissions:** drafting, editing, sending and resending need `DOCUMENT_RELEASE`. _Amended:_
  reading a document's mail needs read access **and** `DOCUMENT_RELEASE` (stricter than first
  written), which keeps requester emails to releasers. The requester email lookup is unscoped for a
  releaser of the outgoing document; ruled acceptable for the pilot because release is restricted
  to administrators and records staff.
- **Validation:** _amended:_ addresses are validated on `PATCH` (the draft edit); the sources a draft
  is built from are already validated at entry, so `send` checks only that **To** is not empty.
- **Audit:** `mail.drafted`, `mail.sent`, `mail.failed`, `mail.resent`, `mail.skipped` (lowercase
  dotted, the repo convention; amended from `MAIL_DRAFTED` etc.), each targeting the document, with
  counts and the message id, never the addresses or body.

## Components

- `packages/contracts`: schemas for mail DTOs, status enum, new capabilities, new audit event types.
- `apps/api/src/modules/mail/`: `mail.service.ts` (draft/edit/send/resend), `mail.repository.ts`,
  `mail.controller.ts`, `mail-sender.ts` (port), `smtp-mail-sender.ts` (nodemailer),
  `mail.processor.ts` (worker handler).
- `apps/web/src/features/mail/`: `compose-mail-dialog.tsx` (To/Cc/Bcc chips, subject, body, PDF chip),
  `document-mail-section.tsx` (Sent/Failed list with status badges and Resend), queries.
- Config: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. All are
  optional; with `SMTP_HOST` unset, Send is disabled and the dialog says mail is not configured. Each
  gets a compose entry in `docker-compose.yml` and the production overlay. Dev compose gains Mailpit.

## Errors

SMTP rejection or timeout → retry, then `FAILED` with `last_error` shown to the releaser (truncated to
500 chars, no credentials). Invalid address → 422 at send. Editing a non-draft → 409. A double-clicked
Send is idempotent through the outbox key.

## Testing

Unit: recipient resolution and de-duplication (outgoing recipients plus linked incoming contact),
template rendering, delivery retry and failure. API: draft on `PREPARE_RELEASE`, send, resend, release guard and
skip, permission and confidential cases, using an in-memory `MailSender`. Web: Compose dialog
validation and disabled state when mail is unconfigured. E2E: full release against Mailpit asserting
the message and PDF attachment arrive.

## Open items

- Sender identity: a single `MAIL_FROM` mailbox for the office. Reply-To (the releaser's division
  address) is **not implemented**; confirm with the office whether it is wanted.
- Default body wording (`DEFAULT_MAIL_BODY`) needs office sign-off before the pilot.
- Retry schedule is now 8 attempts, exponential from 30 s (about an hour).
