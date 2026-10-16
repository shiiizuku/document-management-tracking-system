# Runbook: release mail

When an outgoing document reaches **For release**, the system drafts an email carrying the signed
PDF. The releaser reviews it in the **Release email** section of the document, sends it, and may
then release the document by **Emailed**. The API queues the send; the **worker** delivers it over
SMTP, and the section shows Queued turning Sent or Failed without a reload. Releasing by Emailed
requires a message that is **Sent**, or one that was **skipped** with a remark. A document with no
message at all (prepared with no signed PDF, or already For release when release mail was
deployed) is not held back: Emailed release is allowed and the section says so. A signed file that
is not a PDF (a Word file or an image) drafts nothing.

## Send sends what the releaser reviewed

Every message carries a `revision`, a hash of its stored To, Cc, Bcc, subject and body. **Send**
saves the dialog's edits and then sends with the revision that save returned. If someone else saved
the same draft in between, the send is refused with 409 `MAIL_CHANGED` ("This message was changed
since you opened it; review it again"), nothing is queued, and the dialog reloads the stored draft
for review. Press Send again once it reads right. A script calling the API must send
`{ "revision": "<revision>" }`, taken from its own `PATCH` answer or a fresh `GET`.

A **skipped** draft is locked: editing or sending it is refused with 409 `MAIL_SKIPPED`, so a
Compose dialog left open elsewhere cannot mail a message the releaser chose not to send.

Every mail mutation (edit, send, resend, skip) also needs the session's CSRF header, which the web
app sends itself; a hand-made request without `X-CSRF-Token` gets 403.

## Configure SMTP

Set these in `.env` for the `api` **and** `worker` (both compose services already pass them
through; `docker-compose.production.yml` repeats them with no default host):

| Variable      | Meaning                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| `SMTP_HOST`   | The agency's mail relay. **Empty or unset turns release mail off.**              |
| `SMTP_PORT`   | `587` (default) for STARTTLS, `465` for implicit TLS, `25` for a plain LAN relay |
| `SMTP_SECURE` | `true` for port 465 only. Leave `false` for 587: the connection upgrades itself  |
| `SMTP_USER`   | Optional. Blank sends without authentication (typical for an internal relay)     |
| `SMTP_PASS`   | Optional. Needed only with `SMTP_USER`                                           |
| `MAIL_FROM`   | Required once `SMTP_HOST` is set; the API and worker refuse to boot without it   |

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d api worker
```

Credentials are held only by the SMTP transport. Logs and audit rows carry message ids and a
recipient count, never addresses, the body or the password.

### Check it is configured

```bash
docker compose exec worker sh -c 'echo "host=$SMTP_HOST port=$SMTP_PORT secure=$SMTP_SECURE from=$MAIL_FROM"'
docker compose exec api sh -c 'echo "host=$SMTP_HOST"'
```

The API and the worker must agree. With `SMTP_HOST` empty, **Send** is refused with
`MAIL_NOT_CONFIGURED` ("Outgoing mail is not configured on this server"; the Compose dialog shows
**Mail is not configured**) and nothing is queued; the drafts still appear. To prove delivery, release a test
document to an address you control. Port or TLS mistakes surface as a **Failed** message (below),
not at boot.

## A message shows Failed

The row in **Release email** shows the cause (`last_error`, truncated to 500 characters). The same
text is in the database:

```bash
docker compose exec postgres psql -U dts -d dts -c \
  "select id, status, attempts, last_error, sent_at, skipped_at from mail_messages order by created_at desc limit 10;"
```

The worker logs one line when it gives up, and an audit row `mail.failed` is written:

```bash
docker compose logs worker | grep "failed after"
```

Errors are scrubbed so recipient addresses stay out of logs. Typical causes:

| `last_error`                                       | Meaning and fix                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ECONNREFUSED` / `ETIMEDOUT` / `ENOTFOUND`         | Wrong host or port, firewall, or relay down. Test from inside the worker container           |
| `Greeting never received` / `wrong version number` | TLS mismatch: 465 needs `SMTP_SECURE=true`; 587 needs `false`                                |
| `Invalid login` / `535`                            | `SMTP_USER` / `SMTP_PASS` wrong, or the relay wants none                                     |
| `Sender address rejected` / `553`                  | The relay does not accept `MAIL_FROM`; use a permitted sender                                |
| `Mail is not configured`                           | The worker has no `SMTP_HOST`; fix and restart the worker                                    |
| `Attachment has not been scanned clean`            | The signed file is not `CLEAN`; see [scanner down](scanner-down.md). A retry cannot fix it   |
| `Attachment bytes are missing from storage`        | Restore from backup; not a mail fault                                                        |
| `The mail server rejected N of M recipients`       | The relay refused some addresses and took the rest. Not retried; see below                   |
| `The signed file is not a PDF`                     | A row drafted before the PDF check names a Word file or image. Skip mail or use another method |
| `The mail server accepted the message, …`          | The database failed after SMTP took it, on the last attempt. It probably arrived             |

**Partial rejection.** When the relay refuses some recipients but accepts others, the message is
marked **Failed** at once with the counts only (no addresses, here or in the `mail.failed` audit
row, which also carries `rejected`). It is not retried, because a retry would mail the accepted
recipients again. A Failed row cannot be edited and **Resend** copies its recipients unchanged, so a
resend mails the accepted recipients twice and is likely refused again. Find which address was
refused from the relay's own log, reach that recipient another way, and if the document still has to
go out by Emailed, **Skip mail** with a remark saying so.

### Retry window

A transport error (or a database error while delivering) is retried by the queue: **8 attempts,
exponential backoff from 30 seconds** (30 s, 1, 2, 4, 8, 16 and 32 minutes between them), so about
**an hour** in total. A relay outage shorter than that heals by itself; a longer one marks the
message **Failed**, and it does not keep trying. Fix the cause, then **Resend**. Errors that
retrying cannot fix (unscanned or non-PDF attachment, mail unconfigured, some recipients rejected)
fail on the first attempt. Other outbox events keep the queue default (5 attempts from 1 second).

The **Sent** or **Failed** state commits in one transaction with its `mail.sent` / `mail.failed`
audit row. If the audit write fails, the message stays **Queued** and the next attempt finishes the
job (for a delivered message that means sending it again; see the warning under Resend).

## Resend

Press **Resend** on a **Failed** row. The screen offers it only on the newest Failed row, and only
while no newer message is Queued or Sent. The server also accepts a resend of a **Sent** message,
and in any document status (a lost mail may need resending after the release); a first **Send** of
a Draft, by contrast, is accepted only while the document is For release. It creates a **new** queued message with the same
recipients, subject and body; the original row stays as the record. Resend only after the cause is
fixed, or it fails again. Each resend is audited (`mail.resent`).

**Warning:** resending a Sent message mails the recipients again. A Failed message can also have
reached the recipient before the error (a reply lost on the wire), so a Resend may duplicate it.
That is the accepted trade for never losing a release email.

## Release when mail cannot be sent

**Skip mail** (top right of the Release email section) is offered while the document is For
release, no message is Sent, nothing is already skipped, and at least one message is not Sent — a
**Draft**, or one left **Queued** or **Failed** by a Send. It marks the newest such message. It asks
for a **remark**, which is required: say why and how the document was delivered instead. The skip is
audited (`mail.skipped`, with the message id and the remark's length); the remark itself is kept on
the message. Then **Release document** with method **Emailed** is allowed.

The server refuses Skip only when no unsent message exists (`MAIL_NOTHING_TO_SKIP`), and with 409
`MAIL_ALREADY_SENT` once a message is Sent. A second skip is a quiet success that keeps the first
remark and writes no second audit row.

So with the relay down, after a failed Send the options are:

- **Resend** once SMTP is back.
- **Skip mail** with a remark saying how the document went out, then release by Emailed. Skipping a
  **Queued** message does not stop the worker: if the relay recovers within the retry window it is
  still delivered.
- **Release by a different method** (Mailed, Picked up, Personally delivered). The mail rule applies
  only to Emailed. Use it only if the document is really leaving that way.

With `SMTP_HOST` empty, Send is refused ("Outgoing mail is not configured on this server") and the
row stays a Draft, which Skip mail also accepts.

Do not skip mail to avoid a failure you could fix with Resend.

## Known limitations

- **Duplicates over losses.** If SMTP takes a message and the database then fails, the retry
  sends it again. On the last attempt the row is marked Failed with "The mail server accepted the
  message, but recording the delivery failed"; check with the recipient before resending. If the
  database is down for the whole last attempt, nothing can be recorded and the row stays Queued
  until it is resent or skipped.
- **Every recipient refused is retried.** The relay then rejects the message as a whole, which
  looks like any other transport error, so it fails only after the hour of retries.
- **Partial rejection is final**, and the refused addresses cannot be corrected on the row (above).
- **The revision check compares `updated_at` at millisecond precision.** Two saves of one draft in
  the same millisecond as a Send's read could slip past it; not expected at pilot volume.

## Mailpit in development

`docker compose up` starts **Mailpit**, a mail catcher, and `api` and `worker` default to it
(`SMTP_HOST=mailpit`, port `1025`, `MAIL_FROM=dts@localhost`). Nothing leaves the machine.

- Inbox: <http://localhost:8025> (`MAILPIT_HTTP_PORT` to move it). API: `/api/v1/messages`.
- Both ports are bound to `127.0.0.1`. SMTP is also published on `1025` (`MAILPIT_SMTP_HOST_PORT`)
  for the end-to-end suite, whose API and worker run on the host.
- To send through a real relay from a dev stack, set `SMTP_HOST`/`SMTP_PORT`/`MAIL_FROM` in `.env`.
  `SMTP_HOST=` (empty) turns mail off.
- `docker-compose.production.yml` disables the Mailpit service and sets no default host, so a
  production stack with `SMTP_HOST` unset sends nothing. Verify with
  `docker compose -f docker-compose.yml -f docker-compose.production.yml config --services`, which
  must not list `mailpit`.
- The end-to-end test `apps/e2e/tests/release-mail.spec.ts` needs Mailpit running; see
  [`apps/e2e/README.md`](../../apps/e2e/README.md).
