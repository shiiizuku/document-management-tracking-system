-- Non-destructive routing: scope resolves through custody hops, not through a column that moves.
-- See docs/adr/0005-custody-acceptance-on-the-route-row.md.

-- `relocate` no longer writes `documents.division_id` / `section_id`, so those columns now record
-- where a document was *registered* and never change again; the receiving unit's claim to a
-- document lives on its `document_routes` row. Every list, count and export therefore probes the
-- route rows for "has any hop been addressed to this unit", and this index is what makes that
-- probe cheap.
--
-- `document_routes_unaccepted_idx` cannot serve it: that index is partial on `accepted_at is null`,
-- while this predicate deliberately ignores acceptance — a recipient who cannot read a document
-- could never accept it, so acceptance gates actions and not visibility.
--
-- No backfill. Registration has written a route row since migration 0005 and every forward has
-- written one since the feature existed, so the history this predicate reads is already there;
-- that is precisely why the column could be retired without one.
CREATE INDEX IF NOT EXISTS "document_routes_recipient_idx"
  ON "document_routes" ("to_division_id", "to_section_id", "document_id");
