# Routing slip — reference

The printable slip that travels with a physical document. The app generates it server-side
(`GET /documents/:id/routing-slip.pdf`, behind the same read policy as the record itself); nothing
in `apps/web/public/` is involved, and nothing here is served to a browser.

## What is here

- `print-preview.png` — the generated slip as the print dialog shows it, captured from a seeded
  development database. Every value on it is synthetic (`Test 50`, `Sender 50 · Company 50`,
  `System Administrator`). This is the reference for the layout: the header block, the eight-row
  metadata table, and the routing table's `FROM / DATE-TIME RECEIVED / TO / DATE-TIME RELEASED /
  ACTION TAKEN` columns.

## What is deliberately NOT here

The bureau's own Word template (`MGBR3-FM-ORD-02`) and a scanned sample are **not** in this
repository, and should not be added.

Both are filled-in slips carrying real office traffic — a named subject line, sender, addressee and
received date — and the `.doc` additionally carries authoring metadata: the name of the person who
wrote it and a Grammarly account identifier embedded by their editor. None of that belongs in a
public git history, which is the part that matters: deleting a file in a later commit does not
remove it, every clone keeps it, and the only real remedy is rewriting history across every fork.

Keep those two on the shared drive. If the exact template is needed for layout work, produce a
blank copy — no sender, subject, addressee or dates — strip the document properties, and add that
instead.
