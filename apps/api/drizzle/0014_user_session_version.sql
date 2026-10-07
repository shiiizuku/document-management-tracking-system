-- Risk R-22: sessions are stateless JWTs (ADR-0002), so nothing could end one early. Deactivation
-- worked only because `AuthGuard` re-reads the user and refuses an inactive one; reactivating the
-- account made every session it ever held valid again, and a password change (once there was
-- one) would have left the old sessions running.
--
-- `session_version` is a counter on the user row. A session carries the value it was issued
-- under in its `sv` claim, and `AuthService.getUser` refuses one that no longer matches. Bumping
-- the counter therefore ends every session the user holds, in one write, with no session table.
-- It is bumped on a password change, an administrator reset, deactivation and reactivation.
--
-- Every existing row starts at 0, and a session issued before this migration has no `sv` claim,
-- which is read as 0. So nobody is signed out by the deploy; the first bump ends those sessions
-- like any other.
--
-- Reversible with `ALTER TABLE "users" DROP COLUMN "session_version";`.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "session_version" integer DEFAULT 0 NOT NULL;
