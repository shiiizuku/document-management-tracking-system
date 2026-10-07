# Runbook: incident response

What to do when someone may have access they shouldn't have. That covers a stolen or shared
password, a lost workstation that was signed in, a leaked `.env`, an administrator account acting
oddly, or an `INFECTED` upload. The project lead owns incidents until the role is reassigned (risk
register, _Owner_).

The controls below were exercised on 2026-10-07 against a live stack
([`evidence/e1-failure-drills.md`](../evidence/e1-failure-drills.md)). Where this runbook says what
happens, that is what was observed.

## 1. Contain

Pick the narrowest step that stops the access. They are listed narrowest first.

### One account: deactivate it

**Administration → Users → Deactivate**, or `POST /api/v1/users/:id/deactivate` as an
administrator.

**It takes effect on that user's very next request.** The API reloads the user on every request,
so an existing session doesn't run out its 30 minutes. In the drill, a live session got `401
Account is inactive` 19 ms after the deactivation, and a fresh sign-in was refused. Deactivation
is audited as `user.deactivated`, and the refused sign-in as `auth.login` / `FAILURE` /
`ACCOUNT_INACTIVE`.

Deactivation keeps everything the person did. Their documents, routes and audit trail stay
intact.

**Reactivating brings old sessions back.** Sessions are stateless JWTs (ADR-0002), and
deactivation only refuses them while the account is inactive. In the drill, the session that was
refused after deactivation answered `200` again as soon as the account was reactivated. A
password reset doesn't end sessions either. So for a compromised account, in this order:

1. Deactivate it.
2. Wait 30 minutes, the inactivity expiry (P-10). Every refused request fails without renewing
   the session. If you can't wait, rotate `SESSION_SECRET` (below), which signs everyone out.
3. Reset the password (below).
4. Reactivate it. Reactivating also clears any lockout.

### Every session at once: rotate `SESSION_SECRET`

Use this when you can't tell which session is compromised, or the secret itself may have leaked:
a copied `.env`, a backup of the host, or **a deployment still on the default value** (below).

```bash
# in .env
SESSION_SECRET=<new value: openssl rand -base64 48>
```

```bash
docker compose up -d api worker
```

In the drill the API was `healthy` 9 s after the recreate. Every session issued before it got
`401 Session is invalid or expired`, including a valid administrator session. Everyone signs in
again. Nothing else is lost.

**Check the secret isn't the repository default.** `docker-compose.yml` falls back to
`local-development-session-secret-change-before-pilot` when `.env` doesn't set `SESSION_SECRET`.
The API accepts it in every mode, including `NODE_ENV=production`, because it only checks the
length. **Anyone who has read the repository can sign a session for any user with it.** In the
drill, a session forged with the default as `admin@dts.local`, with no password, got `200` from
`GET /me`. Treat a stack running on the default as already compromised: rotate the secret, then
work through steps 2 and 3.

```bash
docker compose exec api printenv SESSION_SECRET
```

### The whole service: take it off the network

When the scope is unknown, stop the web and API containers. The data stays where it is:

```bash
docker compose stop web api
```

The worker, Postgres, MinIO and ClamAV keep running, so nothing in flight is lost. Bring the web
and API back with `docker compose up -d web api` once the cause is contained.

## 2. Rotate what may have leaked

| Secret | Where it is used | Rotate by |
| --- | --- | --- |
| `SESSION_SECRET` | Signs every session | Above. Signs everyone out |
| A user's password | That user | **There is no change-password or reset feature.** Use the reset below, in the order above |
| `POSTGRES_PASSWORD` | Database | `ALTER USER` in Postgres, then the same value in `.env`, then `docker compose up -d` |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Object store | MinIO console or `mc admin`, then `.env`, then `docker compose up -d` |
| `DIRECTOR_PASSWORD`, `SEED_ADMIN_PASSWORD` | Only read by the seed | Change the account's password in the app. The variables don't reset existing accounts |

**Resetting a password.** DTS has no screen for it: nobody can change a password in the app,
and administrators can't reset one. Set it from the API container, which holds the hashing
library and the same password rule the app enforces:

```bash
docker compose exec -T api node --input-type=module -e 'import bcrypt from "bcryptjs"; import { strongPasswordSchema } from "@dts/contracts"; import pg from "pg"; const [email, pw] = process.argv.slice(1); const s = strongPasswordSchema.safeParse(pw); if (!s.success) { console.error("weak password:", s.error.issues.map((i) => i.message).join("; ")); process.exit(1); } const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect(); const r = await c.query("update users set password_hash = $1, failed_login_attempts = 0, locked_until = null, updated_at = now() where email = $2", [await bcrypt.hash(pw, 12), email]); console.log("updated", r.rowCount); await c.end();' someone@example.gov.ph 'New-Passw0rd-Here!'
```

In the drill a weak password was refused and listed the rule it broke. A strong one printed
`updated 1`, after which the old password got `401` and the new one `201`. `updated 0` means no
account has that email. The reset writes no audit event, so record it yourself. Give the person
the new password in person, not by email.

The `POSTGRES_PASSWORD` and MinIO steps weren't drilled. Rehearse them before relying on them. A
Postgres password in `.env` that no longer matches the database stops `migrate`, `api` and
`worker` from starting.

The compose defaults (`dts`/`dts` for Postgres, `dts-local`/`dts-local1` for MinIO, the
development passwords in the README) are public. A stack holding real records must not run on
any of them (risk register R-09).

## 3. Find out what happened

Every sign-in, every refused sign-in and every change is in `audit_events`. Events are never
updated, deleted or purged (P-08).

**In the app:** Audit, filtered by user, action and date (`GET /api/v1/audit-events?user=&action=&from=&to=`).

**In SQL**, for anything the screen doesn't filter:

```bash
docker compose exec postgres psql -U dts -d dts
```

```sql
-- Sign-ins for one account, newest first, with the reason for each refusal.
select occurred_at, outcome, summary->>'reason' as reason, source_ip
from audit_events
where action = 'auth.login'
  and actor_id = (select id from users where email = 'someone@example.gov.ph')
order by occurred_at desc limit 50;

-- Everything one account did in a window.
select occurred_at, action, target_type, target_id, outcome
from audit_events
where actor_id = (select id from users where email = 'someone@example.gov.ph')
  and occurred_at between '2026-10-07 00:00+08' and '2026-10-07 23:59+08'
order by occurred_at;
```

The refusal reasons recorded are `INVALID_PASSWORD`, `ACCOUNT_LOCKED`, `ACCOUNT_INACTIVE` and
`UNKNOWN_ACCOUNT`. The user only ever sees "Invalid email or password". Those three reasons are
for you, not for an attacker.

**A forged session leaves no sign-in.** If the secret was the default, look for actions with no
`auth.login` `SUCCESS` before them for that account.

**`source_ip` is the reverse proxy's address** unless `TRUST_PROXY` is set. Behind a proxy without
it, every event shows the same address and can't tell staff apart. On a plain localhost stack
every request comes from the Docker bridge (`172.x.0.1`).

## Lockout and the sign-in limit

Two separate controls protect sign-in. Users see them differently:

- **Per-address limit: 5 sign-in attempts a minute.** The sixth gets `429` until the minute is up.
  It counts successes too. Without `TRUST_PROXY`, everyone behind the same proxy shares one
  window. In the drill, earlier sign-ins from the same address used it up, and the second wrong
  password already got `429`.
- **Per-account lockout: 5 wrong passwords lock the account for 15 minutes**
  (`LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_MS`). In the drill, after five wrong passwords spaced out
  past the address limit, the correct password was refused with the same generic message. The
  audit recorded `ACCOUNT_LOCKED`, and the administrator's user list showed `"locked": true`.

**Unlock early:** an administrator presses **Reactivate** on the account. It works on an account
that is still active. In the drill the next sign-in succeeded. The password reset above clears a
lockout too. If the lockout came from someone
else guessing, deactivate the account instead and talk to its owner first.

## Infected uploads

A file ClamAV flags is stored `INFECTED` and is never served. Preview and download refuse it,
like a pending file. This wasn't drilled here. The EICAR test in
`apps/api/test/scanner.int.test.ts` (box B1) covers it against a real ClamAV. Nobody downloaded
it through DTS. Find who uploaded it and from which
document:

```sql
select v.uploaded_at, u.email, f.document_id, v.original_name
from file_versions v
join file_records f on f.id = v.file_record_id
join users u on u.id = v.uploader_id
where v.scan_status = 'INFECTED';
```

The file came from somewhere: the uploader's workstation, or an email or USB stick it arrived on.
That's where the incident is. The `INFECTED` row stays, as part of the record.

## 4. Afterwards

- Write down what happened, the times, and what was rotated. Use the audit queries above for the
  timeline.
- If a control didn't work as written here, update this runbook and the risk register.
- If a lost workstation was signed in, its session ended at the next request after deactivation,
  or after 30 minutes idle (P-10), whichever came first.
