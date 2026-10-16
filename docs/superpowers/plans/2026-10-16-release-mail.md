# Release Mail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email the signed PDF to an outgoing document's recipients and to the requester of any incoming request it answers, after a releaser reviews the message.

**Architecture:** A `mail_messages` table holds drafts and results. `PREPARE_RELEASE` creates a draft inside its transaction. Send moves a draft to `QUEUED` and writes an outbox event; the existing worker delivers it through a `MailSender` port (nodemailer SMTP). `RELEASE` by an "Emailed" method requires a `SENT` message or an audited skip.

**Tech Stack:** NestJS, Drizzle/Postgres, BullMQ outbox, nodemailer, zod (`@dts/contracts`), Next.js/React Query, Vitest, Playwright, Mailpit.

**Spec:** `docs/superpowers/specs/2026-10-16-release-mail-design.md`

## Global Constraints

- Delivery is SMTP only; no Gmail API. Env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`; all optional; `SMTP_HOST` unset disables Send.
- Every new env var gets an entry in `docker-compose.yml` (api and worker) and `docker-compose.production.yml`. New mounted files are pinned to LF.
- Attachment is the signed PDF only: the `signature_events.file_version_id` of the document, clean-scanned.
- Audit summaries hold IDs, counts and enums only; never addresses or bodies (policy P-14).
- Addresses lower-cased and de-duplicated; at most 20 per field; at least one **To** to send.
- Retries: the queue's existing `attempts: 5` with exponential backoff. This replaces the spec's 30 s/2 m/10 m/1 h schedule (Task 4 amends the spec).
- Reuse `DOCUMENT_RELEASE`; add no capability. Audit actions: `mail.drafted`, `mail.sent`, `mail.failed`, `mail.resent`, `mail.skipped`.
- Never run repo-wide prettier; check only your own files with `--end-of-line auto`. Work in the `.claude/worktrees/release-mail` worktree.

## Review Focus

- Outgoing document with no recipient emails and no linked request: draft is created with empty **To**; Send answers 422; release can still be skipped with a remark.
- Same address on the recipient list and the linked request, differing in case: appears once.
- Signed file version later scanned `INFECTED` or its bytes missing: the worker marks `FAILED` with a reason and never sends.
- Send double-clicked or retried after a worker crash: exactly one SMTP delivery (outbox key `mail.send:<mailId>`).
- Reader without `DOCUMENT_RELEASE`, or without read access to a confidential document: 403/404, never the addresses.

## File Structure

- `packages/contracts/src/index.ts`: mail DTO schemas and types.
- `apps/api/src/database/schema.ts` + `drizzle/0017_mail_messages.sql`: table.
- `apps/api/src/modules/mail/mail-sender.ts`: `MailSender` port. `smtp-mail-sender.ts`: nodemailer binding.
- `apps/api/src/modules/mail/mail-recipients.ts`: pure address resolution and de-duplication.
- `apps/api/src/modules/mail/mail.repository.ts`, `mail.service.ts`, `mail.controller.ts`, `mail.processor.ts`.
- `apps/api/src/worker.ts`, `app.module.ts`, `config/environment.ts`: wiring.
- `apps/web/src/features/mail/`: `queries.ts`, `compose-mail-dialog.tsx`, `document-mail-section.tsx`.

---

### Task 1: Contracts, table and config

**Files:**
- Modify: `packages/contracts/src/index.ts`, `apps/api/src/database/schema.ts`, `apps/api/src/config/environment.ts`, `docker-compose.yml`, `docker-compose.production.yml`, `.env.example`
- Create: `apps/api/drizzle/0017_mail_messages.sql` (via `npm run db:generate -w @dts/api`)
- Test: `packages/contracts/test/contracts.test.ts`, `apps/api/test/environment.test.ts`

**Interfaces:**
- Produces (contracts): `mailStatusSchema = z.enum(['DRAFT','QUEUED','SENT','FAILED'])`; `mailAddressListSchema = z.array(z.string().trim().toLowerCase().email()).max(20)`; `updateMailDraftSchema = z.object({ to, cc, bcc: mailAddressListSchema, subject: z.string().trim().min(1).max(240), body: z.string().trim().min(1).max(10000) })`; `skipMailSchema = z.object({ remarks: z.string().trim().min(1).max(2000) })`; `MailMessage` type `{ id, documentId, to, cc, bcc, subject, body, attachmentName, status, attempts, lastError: string | null, sentAt: string | null, createdAt }`.
- Produces (db): `mailMessages` table in `schema.ts`, columns as in the spec's Data table, `status` a pg enum `mail_status`.
- Produces (env): `Environment.SMTP_HOST?`, `SMTP_PORT: number` (default 587), `SMTP_SECURE: boolean` (default false), `SMTP_USER?`, `SMTP_PASS?`, `MAIL_FROM?`.

- [ ] **Step 1: Write failing tests.** `contracts.test.ts`: `updateMailDraftSchema` lower-cases `'A@X.PH'`, rejects 21 addresses and `'not-an-email'`. `environment.test.ts`: `SMTP_HOST` unset gives `SMTP_HOST === undefined`; `SMTP_PORT` `'abc'` throws; `SMTP_HOST` set without `MAIL_FROM` throws `MAIL_FROM is required when SMTP_HOST is set`.
- [ ] **Step 2: Run** `npm test -w @dts/contracts -w @dts/api -- environment contracts`. Expected: FAIL (schemas and fields missing).
- [ ] **Step 3: Implement** the contracts, the `mailMessages` table (FKs to `documents`, `file_versions`, `users`; `to/cc/bcc` as `text[]`), the env parsing with the existing `parsePositiveInteger`/`parseBoolean` helpers, and run `db:generate`. Add compose entries (`${SMTP_HOST:-}` style) and `.env.example` lines. Check `schema-conventions.test.ts` still passes.
- [ ] **Step 4: Run** the same command plus `npm test -w @dts/api -- schema-conventions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mail): contracts, mail_messages table and SMTP config`.

### Task 2: Recipient resolution and sender port

**Files:**
- Create: `apps/api/src/modules/mail/mail-recipients.ts`, `mail-sender.ts`, `smtp-mail-sender.ts`, `apps/api/test/in-memory-mail-sender.ts`
- Test: `apps/api/test/mail-recipients.test.ts`, `apps/api/test/smtp-mail-sender.test.ts`
- Modify: `apps/api/package.json` (add `nodemailer`, `@types/nodemailer`)

**Interfaces:**
- Produces: `resolveMailRecipients(input: { recipients: DocumentRecipient[]; requesterEmails: (string | null)[] }): string[]` (lower-cased, de-duplicated, order-preserving).
- Produces: abstract `MailSender { send(message: OutgoingMail): Promise<{ messageId: string }> }`; `OutgoingMail = { from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; attachment: { filename: string; content: Uint8Array; contentType: string } }`.
- Produces: `SmtpMailSender implements MailSender` built from `{ host, port, secure, user?, pass?, from }`; `InMemoryMailSender` records `sent: OutgoingMail[]` and can be told to throw.

- [ ] **Step 1: Write failing tests.** `mail-recipients.test.ts`: `[{name:'A',emails:['X@y.ph']}]` plus requester `['x@Y.PH', null, 'z@y.ph']` returns `['x@y.ph','z@y.ph']`; empty inputs return `[]`. `smtp-mail-sender.test.ts`: with nodemailer's `jsonTransport` injected, `send` returns a `messageId` and the JSON carries the attachment filename and the subject.
- [ ] **Step 2: Run** `npm test -w @dts/api -- mail-recipients smtp-mail-sender`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the three modules. `SmtpMailSender` takes an optional pre-built transport for tests; production builds one with `nodemailer.createTransport` and omits `auth` when `user` is unset.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mail): recipient resolution and SMTP sender port`.

### Task 3: Mail service, repository and HTTP

**Files:**
- Create: `apps/api/src/modules/mail/mail.repository.ts`, `mail.service.ts`, `mail.controller.ts`, `apps/api/test/in-memory-mail.repository.ts`
- Modify: `apps/api/src/app.module.ts` (register controller, service, repository, `MailSender` binding), `apps/api/src/modules/documents/documents.repository.ts` (add `listLinkedRequesterEmails(outgoingDocumentId): Promise<(string | null)[]>`, unscoped: it reads `documents.email` of incoming rows joined through `document_references`), `apps/api/test/in-memory-documents.repository.ts` (same method)
- Test: `apps/api/test/mail.test.ts`

**Interfaces:**
- Consumes: `OutboxWriter.enqueue`, `AuditWriter.write`, `fakeTransactionalDatabase`, `resolveMailRecipients`.
- Produces on `MailService`:
  - `createDraft(documentId: string, actorId: string, tx: DatabaseExecutor): Promise<MailMessage | null>` (null when no signed file version; idempotent per document)
  - `list(actor: RequestUser, documentId: string): Promise<MailMessage[]>`
  - `update(actor, documentId, mailId, input: UpdateMailDraft): Promise<MailMessage>` (409 unless `DRAFT`)
  - `send(actor, documentId, mailId): Promise<MailMessage>` (422 on empty **To** or unconfigured SMTP; moves to `QUEUED`; enqueues `mail.send` with key `mail.send:<mailId>`)
  - `resend(actor, documentId, mailId): Promise<MailMessage>` (copies a `SENT`/`FAILED` row into a new `QUEUED` row; audit `mail.resent`)
  - `skip(actor, documentId, input: SkipMail): Promise<void>` (audit `mail.skipped` with remarks length only)
  - `hasSent(documentId: string): Promise<boolean>`
- Produces routes under `documents/:id/mail`: `GET`, `PATCH :mailId`, `POST :mailId/send`, `POST :mailId/resend`, `POST skip`. All require `DOCUMENT_RELEASE` and read access to the document (reuse the check `DocumentsService` uses for `getDocument`).
- Body template: constant `DEFAULT_MAIL_BODY` in `mail.service.ts` (office-editable setting is deferred; see Open items). Subject `${referenceNumber}: ${title}`.

- [ ] **Step 1: Write failing tests** in `mail.test.ts` (full-app, in-memory doubles, same harness as `reference-documents.test.ts`):
  - `createDraft` merges outgoing recipient emails and a linked incoming requester's email, de-duplicated.
  - `createDraft` returns `null` without a signed version.
  - `send` with empty **To** returns 422; with SMTP unconfigured returns 422 `MAIL_NOT_CONFIGURED`; success sets `QUEUED` and one outbox event; a second `send` adds no second event.
  - `update` on a `QUEUED` message returns 409.
  - A user without `DOCUMENT_RELEASE` gets 403; an unreadable confidential document gets 404 with the same body as a missing id.
  - `resend` leaves the original row unchanged.
- [ ] **Step 2: Run** `npm test -w @dts/api -- mail.test`. Expected: FAIL.
- [ ] **Step 3: Implement** repository (Drizzle, `ON CONFLICT DO NOTHING` on a unique `(document_id)` partial index for `DRAFT` rows to make drafting idempotent), service and controller per the Interfaces block. Audit summaries carry `{ recipients: n }` only.
- [ ] **Step 4: Run** `npm test -w @dts/api -- mail.test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mail): draft, edit, send and resend endpoints`.

### Task 4: Worker delivery and retries

**Files:**
- Create: `apps/api/src/modules/mail/mail.processor.ts`
- Modify: `apps/api/src/worker.ts`, `docs/superpowers/specs/2026-10-16-release-mail-design.md` (replace the retry-schedule sentence with "the queue's 5 attempts with exponential backoff")
- Test: `apps/api/test/mail-processor.test.ts`

**Interfaces:**
- Consumes: `MailSender`, `StoragePort.get`, `FileVersionsRepository`, `MailRepository`, `AuditWriter`.
- Produces: `deliverMail(deps: MailDeliveryDeps, mailId: string, attempt: { made: number; max: number }): Promise<void>`. It throws on a retryable failure so BullMQ retries; on the final attempt it records `FAILED` and does not throw.

- [ ] **Step 1: Write failing tests** with in-memory doubles: success marks `SENT` with `smtp_message_id` and writes `mail.sent`; sender throwing on attempt 2 of 5 rethrows and records `attempts`/`last_error`; throwing on attempt 5 marks `FAILED`, writes `mail.failed`, does not rethrow; `scanStatus !== 'CLEAN'` or missing bytes marks `FAILED` immediately without calling the sender; a message already `SENT` returns without sending.
- [ ] **Step 2: Run** `npm test -w @dts/api -- mail-processor`. Expected: FAIL.
- [ ] **Step 3: Implement** `deliverMail` and branch `job.data.eventType === 'mail.send'` in `worker.ts` using `job.attemptsMade + 1` and `job.opts.attempts`. Truncate `last_error` to 500 chars and strip nothing else (the sender never logs credentials). Build `SmtpMailSender` once, only when `SMTP_HOST` is set.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mail): worker delivery with retry and failure state`.

### Task 5: Draft on PREPARE_RELEASE and the release guard

**Files:**
- Modify: `apps/api/src/modules/documents/documents.service.ts` (inside the `executeAction` transaction near `documents.service.ts:1141`), `apps/api/src/modules/workflow/workflow.service.ts` (add `mailSent: boolean` and `mailSkipped: boolean` to `WorkflowDocument`; guard in the `RELEASE` block)
- Test: `apps/api/test/workflow.test.ts`, `apps/api/test/mail.test.ts`

**Interfaces:**
- Consumes: `MailService.createDraft`, `hasSent`, a skip lookup `MailService.hasSkipped(documentId): Promise<boolean>`.
- Produces: `WorkflowRuleError('Emailed release requires the message to be sent or skipped', 'RELEASE_MAIL_REQUIRED')`. The guard applies when the release method code is `EMAILED` and direction is `OUTGOING`.

- [ ] **Step 1: Write failing tests.** `workflow.test.ts`: `RELEASE` with `EMAILED`, `mailSent=false`, `mailSkipped=false` throws code `RELEASE_MAIL_REQUIRED`; with either true it passes; `POSTAL` ignores both flags. `mail.test.ts`: `PREPARE_RELEASE` over HTTP creates one `DRAFT`; repeating the action path after a conflict does not create a second.
- [ ] **Step 2: Run** `npm test -w @dts/api -- workflow mail.test`. Expected: FAIL.
- [ ] **Step 3: Implement** the guard (read the method by `code`, like the existing rule reads `requiresCarrier`), populate the two flags in `toWorkflowDocument`, and call `createDraft` in the transaction when `action === 'PREPARE_RELEASE'`.
- [ ] **Step 4: Run** the same command plus `npm test -w @dts/api`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mail): draft on prepare-release, require sent or skipped for emailed release`.

### Task 6: Compose dialog and mail section (web)

**Files:**
- Create: `apps/web/src/features/mail/queries.ts`, `compose-mail-dialog.tsx`, `document-mail-section.tsx`
- Modify: `apps/web/src/features/documents/document-detail-screen.tsx` (render `<DocumentMailSection document={detail} />` beside `ReferencesSection`, outgoing documents only)
- Test: `apps/web/test/compose-mail-dialog.test.tsx`

**Interfaces:**
- Consumes: the Task 3 routes via the existing `api` helper.
- Produces: `useMailMessages(documentId)`, `useUpdateMail(documentId)`, `useSendMail(documentId)`, `useResendMail(documentId)`, `useSkipMail(documentId)` (mutations invalidate the document and mail queries like `useLinkReference`).

- [ ] **Step 1: Write failing tests:** the dialog shows To/Cc/Bcc chips pre-filled from the draft, the PDF chip, and a disabled Send with "Add a recipient" when **To** is empty; a 422 `MAIL_NOT_CONFIGURED` renders "Mail is not configured"; a `FAILED` row shows `lastError` and a Resend button; the section is absent for an incoming document and for a reader without `DOCUMENT_RELEASE`.
- [ ] **Step 2: Run** `npm test -w @dts/web -- compose-mail-dialog`. Expected: FAIL.
- [ ] **Step 3: Implement** dense UI per the project style (compact rows, no decorative spacing): a status badge per message (Draft/Queued/Sent/Failed), Compose opens the dialog, a "Skip mail" link opens a remarks prompt that calls `useSkipMail`. Show the section only while the document is `FOR_RELEASE`, `RELEASED` or `ARCHIVED`.
- [ ] **Step 4: Run** `npm test -w @dts/web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mail): compose dialog and mail section`.

### Task 7: Mailpit and end-to-end

**Files:**
- Modify: `docker-compose.yml` (add `mailpit` service, api/worker `SMTP_HOST: mailpit`, `SMTP_PORT: 1025`, `MAIL_FROM`), `apps/e2e/playwright.config.ts`, `docs/runbooks/` (add `release-mail.md`: configure SMTP, read a failed message, resend)
- Test: `apps/e2e/tests/release-mail.spec.ts`

**Interfaces:**
- Consumes: Mailpit's HTTP API at `http://localhost:8025/api/v1/messages`.

- [ ] **Step 1: Write the failing e2e test:** create an outgoing document with a recipient email, link an incoming request carrying a contact email, sign, prepare release; assert the Compose dialog shows both addresses; send; assert Mailpit holds one message to both addresses with a PDF attachment named after the signed file; release by "Emailed" succeeds.
- [ ] **Step 2: Run** the e2e suite per `apps/e2e` README. Expected: FAIL (no mailpit service).
- [ ] **Step 3: Implement** the compose service, config and runbook.
- [ ] **Step 4: Run** the e2e test and `npm run quality` for your own files only (`prettier --check --end-of-line auto <files>`, then `npm run lint`, `npm run typecheck`, `npm test`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(mail): mailpit dev service, e2e and runbook`.

## Open items carried from the spec

- Office-editable body template (`office_settings`) is deferred; Task 3 ships a constant `DEFAULT_MAIL_BODY`. Wording needs office sign-off before the pilot.
- Sender identity: one `MAIL_FROM`; Reply-To by division is not built.
- The requester lookup in Task 3 reads linked incoming contacts without the reader scoping decision 166 applies to the references list. Only a releaser sees them and only inside the mail draft; confirm this is acceptable.
