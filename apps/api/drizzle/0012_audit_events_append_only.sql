-- P-08: audit events are retained for five years and are **never purged**; after five years they
-- are moved to a separate database. This migration makes the primary half of that a property of
-- the table rather than a convention the application happens to follow.
--
-- * **UPDATE is refused, always.** An audit event records what happened; nothing in the
--   application edits one, and nothing should.
-- * **DELETE and TRUNCATE are refused** unless the session has set `dts.allow_audit_removal` to
--   `on`. Exactly two places set it, and `audit-relocation.test.ts` fails if a third appears:
--     - `AuditRelocator` (`src/modules/audit/audit-relocation.ts`), which deletes a row only after
--       the archive database holds an identical copy of it — relocation, not purge;
--     - the end-to-end suite's per-spec reset (`apps/e2e/fixtures/database.ts`), whose database is
--       disposable by construction.
--
-- What this is **not**: a security boundary. Any role that can run SQL can set a custom setting,
-- so this stops a purge written by mistake — a stray `DELETE`, a "cleanup" job, a careless
-- TRUNCATE list — not a hostile database administrator. Withholding UPDATE/DELETE from the
-- application's runtime role is the boundary, and remains an open hardening item in M6.
--
-- Reversible by dropping the three triggers and the function; no data is touched.

CREATE OR REPLACE FUNCTION "audit_events_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_events is append-only: an audit event is never edited (policy P-08)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF coalesce(current_setting('dts.allow_audit_removal', true), '') <> 'on' THEN
    RAISE EXCEPTION 'audit_events is never purged (policy P-08); rows leave the primary database only through the verified relocation path'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_events_no_update" BEFORE UPDATE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_guard"();
--> statement-breakpoint
CREATE TRIGGER "audit_events_no_delete" BEFORE DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_guard"();
--> statement-breakpoint
CREATE TRIGGER "audit_events_no_truncate" BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_guard"();
