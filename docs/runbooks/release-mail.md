# Runbook: release mail

When an outgoing document reaches **For release**, the system drafts an email carrying the signed
PDF. The releaser reviews it in the **Release email** section of the document, sends it, and may
then release the document by **Emailed**. The API queues the send; the **worker** delivers it over
SMTP. Releasing by Emailed requires a message that is **Sent**, or one that was **skipped** with a
remark.

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

The API and the worker must agree. With `SMTP_HOST` empty, **Send** answers **Mail is not
configured** and nothing is queued; the drafts still appear. To prove delivery, release a test
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
| `Outgoing mail is not configured`                  | The worker has no `SMTP_HOST`; fix and restart the worker                                    |
| `Attachment has not been scanned clean`            | The signed file is not `CLEAN`; see [scanner down](scanner-down.md). A retry cannot fix it   |
| `Attachment bytes are missing from storage`        | Restore from backup; not a mail fault                                                        |

### Retry window

A transport error is retried by the queue: **5 attempts, exponential backoff from 1 second**
(1 + 2 + 4 + 8), so about **15 seconds** in total. An outage longer than that marks the message
**Failed**; it does not keep trying. Fix the cause, then **Resend**. Errors that retrying cannot fix
(unscanned attachment, mail unconfigured) fail on the first attempt.

## Resend

Press **Resend** on a **Failed** row. The server also accepts a resend of a **Sent** message, but the
screen offers the button on Failed rows only. It creates a **new** queued message with the same
recipients, subject and body; the original row stays as the record. Resend only after the cause is
fixed, or it fails again. Each resend is audited (`mail.resent`).

**Warning:** resending a Sent message mails the recipients again. A Failed message can also have
reached the recipient before the error (a reply lost on the wire), so a Resend may duplicate it.
That is the accepted trade for never losing a release email.

## Release when mail cannot be sent

**Skip mail** (top right of the Release email section) is offered only while all of these hold: the
document is For release, no message is Sent or already skipped, and a **Draft** row exists. The
server refuses otherwise (`MAIL_NOTHING_TO_SKIP`). It asks for a **remark**, which is required: say
why and how the document was delivered instead. The skip is audited (`mail.skipped`, with the
remark's length); the remark itself is kept on the message. Then **Release document** with method
**Emailed** is allowed.

**Known limitation:** once **Send** has been pressed, the Draft becomes Queued and then Failed, and
Skip mail is no longer available. So with the relay down, Skip mail works only if the releaser has
not pressed Send, or if `SMTP_HOST` is empty (Send answers "Mail is not configured" and the row
stays a Draft). After a failed send the options are:

- **Resend** once SMTP is back. Emailed release stays blocked until a message is Sent.
- **Release by a different method** (Mailed, Picked up, Personally delivered). The mail rule applies
  only to Emailed, so this does not need a Sent or skipped message. Use it only if the document is
  really leaving that way.

Do not skip mail to avoid a failure you could fix with Resend.

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
