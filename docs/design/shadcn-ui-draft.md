# Shadcn UI draft

Open `/ui-draft` in the web app to review this read-only concept. It is isolated from the production navigation and uses five fictional records dated relative to **4 October 2026**. It makes no API requests and submits no workflow actions.

The draft uses the repository's existing shadcn UI components and theme. It explores:

- A registry with visible search, advanced filters, removable filter chips, and table, card, and compact line layouts.
- A “My work” view ordered by due date, with overdue and due-today labels.
- Record links with a short decision summary and a preview of the next action. On phones, the action appears before supporting metadata.

The [mobile preview](./shadcn-ui-draft-mobile.png) shows “My work” in the card layout. The layout switcher also lets reviewers compare table and compact line presentations. Search, filters, navigation, and the preview dialog can be tried in the running draft; “Register document” is disabled because the draft does not create records.

These are layout and interaction proposals. Before integrating them into live screens, connect them to the existing document queries, role-based action rules, and real due-date calculations.
