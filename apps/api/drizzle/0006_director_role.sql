-- The DIRECTOR role: the sole signatory for outgoing correspondence.
-- See docs/adr/0006-signing-authority-is-its-own-role.md.

-- Additive and backfill-free: no existing row changes role, and nothing is taken away from the
-- type. `IF NOT EXISTS` keeps the migration re-runnable against a database that already has it.
--
-- Postgres refuses to *use* a newly added enum value in the transaction that adds it, so nothing
-- below may insert or compare a 'DIRECTOR' row. Seeding the Director account is the seed's job
-- (`src/database/seed.ts`), which runs in its own transaction after this one commits.
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'DIRECTOR';
