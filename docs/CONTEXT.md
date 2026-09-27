# Document Tracking System — Product and Delivery Context

## Purpose and authority

This document consolidates the 151 architecture and product decisions agreed during the planning interview, the attached DTS specification, and the available prior project snapshot. It is the working source of truth for implementation planning; it does not assert that the prior prototype already satisfies these decisions.

When sources appear to differ, apply them in this order:

- The explicit decisions and MVP boundary in the planning interview and continuation request.
- The attached DTS specification.
- The prior project as implementation evidence and a reusable starting point, not as authority to narrow the target.

The schedule is deliberately capacity-based rather than deadline-based. “Week” means one 20–25 hour development week. Each phase is exit-criteria gated; unfinished work moves forward before the next dependent phase begins.

## Product outcome

The DTS replaces paper routing slips and fragmented email tracking with one accountable record of each incoming or outgoing document. The MVP is a complete predefined-workflow vertical slice used by the Records Office and one pilot division on an organization-hosted environment. It includes secure immutable file versions, metadata search, PDF/XLSX core reports, persistent realtime in-app notifications, end-to-end acceptance, and verified backup/recovery.

## Canonical language

### Organization and access

**Organization**: The bureau or agency operating one DTS installation.

**Division**: A top-level operational unit that may receive custody of a document and contains sections. Use “division,” not “department,” in user-facing language.

**Section**: A work unit within a division to which a user and document may be assigned.

**Records Office**: The records function responsible for intake, registration, outgoing release, organization-wide visibility, and core reporting.

**User**: An approved person with an active account, one organizational placement, and one or more authorized capabilities.

**Role**: A named bundle of capabilities. Role determines what a user may do; organizational scope determines where they may do it.

**Organizational scope**: The divisions, sections, assigned items, or explicitly shared items a user may access.

### Documents and files

**Document**: The tracked business record and its metadata, workflow state, custody, participants, immutable file versions, and event history. It is not merely an uploaded file.

**Incoming document**: Correspondence received from outside the organization; it retains the sender’s reference number when supplied.

**Outgoing document**: Correspondence issued by the organization; it receives a unique division-based reference number and cannot be released without a required attachment and signature.

**Tracking number**: The system-generated stable identifier for a Document.

**Reference number**: The external sender reference for incoming correspondence or the organization-issued identifier for outgoing correspondence. It is distinct from the Tracking number.

**Attachment**: A logical file associated with a Document.

**File version**: An immutable stored binary plus filename, media type, size, cryptographic digest, uploader, and upload timestamp. Replacing a file creates a new version; it never overwrites the prior version.

**Current file version**: The version presented by default. Prior versions remain authorized, discoverable from the Document, and auditable.

**Metadata**: Searchable structured facts about a Document, including title, type, direction, status, priority, sender/recipient, company, references, dates, division, section, and assignee.

### Workflow and accountability

**Workflow definition**: The predefined state machine and transition rules used by the MVP. Ad-hoc workflow design is outside the MVP.

**Workflow state**: One of Pending, In Process, For Revision, For Signature, Signed, For Release, Released, or Archived.

**Custody**: The division/section currently responsible for action on a Document.

**Assignment**: Responsibility given to a specific section or user without changing the Document’s identity.

**Route**: A recorded transfer of custody to a division or section.

**Forward**: A recorded collaboration route to one or more additional divisions while preserving the originating workflow context.

**Transition**: An authorized move between legal workflow states, recorded atomically with its event and any required remarks.

**Revision**: A return from active review/signature processing to For Revision, followed by a new immutable file version and resubmission.

**Signature record**: The recorded authorization action, actor, time, and related file version. The MVP does not imply a public-key digital-signature service unless separately approved.

**Release**: The recorded dispatch of an outgoing Document using an allowed delivery method.

**Archive**: Removal from active work while preserving the Document, versions, history, and authorized retrieval. Restore returns an archived Document to Released.

**Audit event**: An append-only record of a meaningful action, actor, time, affected Document, before/after facts where applicable, and request context.

**Timeline**: The authorized chronological presentation of workflow and audit events for one Document.

**SLA target**: The applicable working-day service target, including ARTA classifications where configured.

**Overdue**: A nonterminal Document whose applicable due date has passed.

### Notifications, reporting, and operations

**Persistent notification**: A database-backed user notification that survives refresh, disconnect, and restart until read or otherwise resolved.

**Realtime delivery**: A best-effort live signal that a persistent notification is available; reconnecting clients reconcile from the database.

**Core report**: The agreed operational monthly/filtered report for incoming, outgoing, FOI requests, and special orders, exportable as PDF and XLSX.

**Routing slip**: A printable, branded view of the Document’s journey, states, actors, timestamps, and remarks.

**Pilot**: A separately hosted organization environment used by the Records Office and one division with real acceptance scenarios, operational ownership, backup, and recovery checks.

## Decision register (1–151)

The wording below is normalized for implementation. Decisions 1–75 retain the attached functional intent; 76–137 consolidate the recorded project architecture and security posture; 138–151 capture the final MVP, pilot, sequencing, and open-policy decisions.

### Product and workflow decisions (1–45)

1. Account access begins through an account request from the login surface.
2. Administrators approve or reject account requests before access is granted.
3. Approval assigns role, division, and section at onboarding.
4. Administrators can deactivate accounts without deleting their historical identity.
5. Users authenticate with email and password.
6. A user may upload a profile photo used in identity-bearing UI and history views.
7. Inactive sessions expire after a configured period.
8. Administrators may create accounts directly.
9. Every user receives a role-appropriate dashboard.
10. The dashboard exposes pending work in the user’s authorized organizational scope.
11. Overdue work is visibly distinguished and actionable.
12. Authorized users can see pending counts by division to identify bottlenecks.
13. The dashboard contains a scope-aware recent-activity feed.
14. Authorized users can accept and assign pending documents to a section from the dashboard.
15. Staff can create a Document with title, type, description, and required direction-specific metadata.
16. A Document can contain multiple attachments.
17. Authorized users can preview supported PDF and image files inline.
18. Authorized users can edit permitted metadata while preserving an audit of changes.
19. Metadata search covers title, tracking/reference number, sender, and company.
20. Lists can filter by status, priority, type, direction, division, and section.
21. Lists can sort by date, priority, and status.
22. Document lists are server-paginated.
23. Authorized division leadership can route work to a division or section.
24. Authorized leadership can forward a Document to multiple divisions for parallel collaboration.
25. Authorized signatories can record a signature action tied to the relevant file version.
26. Authorized reviewers can return a Document for revision with remarks.
27. Authorized releasing staff record release method as mailed, emailed, picked up, delivered, or another configured allowed method.
28. Authorized staff can archive a completed Document without destroying it.
29. “Delete” is administrative logical removal/quarantine, not destruction of files, versions, or audit evidence.
30. Each Document exposes its full authorized timeline.
31. Timeline entries identify actor and timestamp.
32. Transition remarks are preserved and shown in context.
33. Incoming registration retains the sender’s reference number.
34. Outgoing registration generates a unique division-based reference number.
35. Incoming correspondence has a dedicated records view.
36. Outgoing correspondence has a division-grouped view.
37. Outgoing release requires both an attachment and a signature record.
38. The predefined lifecycle is Pending → In Process ↔ For Revision → For Signature → Signed → For Release → Released → Archived.
39. The server rejects illegal state transitions regardless of client behavior.
40. Authorized administrators can restore Archived Documents to Released.
41. The UI and API expose only allowed next actions for the current state and user.
42. Workflow transition and its audit event commit in one database transaction.
43. Route/assignment changes and their audit events commit atomically.
44. Concurrent workflow actions use server-side conflict protection so one action cannot silently overwrite another.
45. Remarks and required evidence are validated at the transition boundary, not only in the UI.

### Organization, access, notifications, reports, and UX (46–75)

46. Administrators maintain divisions and sections to match the approved organization structure.
47. Division leadership can delegate downward to sections in its scope.
48. A user has a specific section placement where applicable.
49. Administrators and Records Office roles have organization-wide document visibility.
50. Division leadership can manage only documents in its authorized division scope, except explicit shares.
51. Staff process only documents in their division/section scope, assignments, or explicit shares.
52. Viewer access is read-only within authorized scope.
53. Scope checks apply to every read, search, preview, download, mutation, report, and realtime event.
54. Authorized administrators can investigate the full audit trail.
55. Assignment creates a persistent notification for the recipient.
56. The application displays an unread-notification count.
57. A user can mark their notifications as read.
58. User-initiated actions return immediate success/error feedback; domain notifications are not replaced by transient toasts.
59. Records staff can generate monthly totals for incoming, outgoing, FOI requests, and special orders.
60. Core reports filter by month and year and respect authorization scope.
61. Core reports can be printed and exported.
62. Authorized users can print a routing slip.
63. The routing slip mirrors the timeline, including status and remarks at each step.
64. The routing slip uses an organization-approved seal/brand asset.
65. Audit events are immutable through the application and database privileges used by the application.
66. Audit search filters by user, action type, and date range.
67. Passwords are stored only as strong adaptive hashes; the prior bcrypt choice remains acceptable for the MVP.
68. Authentication endpoints have stricter rate limits and failed-login protections.
69. All API inputs are validated at the boundary.
70. Browser API access uses a configured CORS allow-list.
71. Performance is validated against an agreed pilot-sized dataset and normal pilot load.
72. Page transitions may be polished but must not block core work.
73. Reduced-motion preferences disable nonessential animation.
74. Core workflows are responsive for desktop, tablet, and usable mobile widths.
75. Keyboard operation and shortcuts must preserve accessible focus, semantics, and discoverability.

### Recorded technical architecture and security baseline (76–137)

76. The prior Node.js/Express service is the reusable server starting point, subject to gap remediation.
77. The React/Vite client is the reusable UI starting point, replacing representative data with real API adapters.
78. PostgreSQL is the system-of-record database.
79. Schema changes are migration-controlled; destructive schema sync is prohibited in pilot and production.
80. The server retains controller/service separation so business rules have one testable home.
81. REST endpoints use a versioned base path.
82. API responses use a consistent success/error envelope and stable machine-readable error codes.
83. OpenAPI documentation is maintained with the implemented API.
84. Stable UUIDs identify core database entities; human-readable tracking/reference numbers remain separate.
85. The server, not the client, generates and enforces uniqueness of tracking/reference numbers.
86. The workflow is represented as an explicit finite-state machine.
87. Workflow authorization combines capability, scope, current state, and record-specific conditions.
88. Records Office visibility is modeled explicitly and is not conflated with unrestricted technical administration.
89. Roles and permissions are centrally defined and deny by default.
90. Division/section scope is centrally enforced before data reaches controllers or export/render paths.
91. Explicit shares are modeled and auditable rather than implemented as scope bypasses.
92. Confidential Documents require an additional explicit authorization rule.
93. Account deactivation prevents new sessions and revokes refresh capability.
94. Access tokens are short-lived.
95. Refresh tokens rotate, are revocable, and are stored as hashes.
96. Password changes revoke other refresh sessions.
97. Failed logins trigger temporary lockout without revealing account existence.
98. Authentication and authorization failures are security logged without secrets or file contents.
99. Production startup fails when required secrets or database configuration are absent.
100. Development secrets and seeded credentials are never reused for the pilot.
101. HTTPS is required at the pilot ingress.
102. Security headers, request-size limits, parameter-pollution protection, and origin restrictions are enabled.
103. Database access uses parameterized ORM/query APIs.
104. Unexpected server errors return generic client messages while retaining correlation IDs for support.
105. Structured application logs include request correlation IDs and defined rotation/retention.
106. Personally identifying and confidential metadata is minimized in logs.
107. File uploads use an allow-list of required media types and configured size limits.
108. Uploaded filenames are treated as untrusted display data and never as storage paths.
109. Every file version receives a server-generated storage key and cryptographic digest.
110. File binaries are stored outside the public web root.
111. File access is mediated by an authenticated, authorized application endpoint or short-lived signed retrieval mechanism.
112. File replacement creates a new immutable File version linked to the same Attachment.
113. Existing file-version rows and binaries cannot be updated through application code.
114. File creation records uploader, timestamp, size, media type, original name, digest, and storage key.
115. File and metadata writes use a failure-safe sequence with cleanup/reconciliation for partial storage/database failure.
116. Pilot malware scanning or an explicit compensating quarantine process is required before general release; selection of a scanning product is deferred to deployment design.
117. Inline preview is restricted to validated supported types and uses safe content-disposition/security headers.
118. Search begins with indexed PostgreSQL metadata queries; full-text/trigram optimization is introduced only when measured volume requires it.
119. Search, list, dashboard, and report queries share the same authorization-scope predicates.
120. Relevant status, scope, identifier, timestamp, unread-notification, and report-filter columns are indexed from measured query plans.
121. Audit events are append-only and have no ordinary update/delete endpoint.
122. Database grants or triggers prevent the runtime application role from mutating audit events and committed file-version evidence.
123. Audit events preserve actor identity even after account deactivation.
124. Audit events include action, target, time, and meaningful before/after or transition facts.
125. Audit capture for security-relevant actions extends beyond document status changes to authentication, access administration, exports, and evidence operations.
126. Persistent notifications are created in the same transaction as the domain action that causes them, or through a transactional outbox with equivalent delivery guarantees.
127. Realtime delivery uses authenticated user-scoped channels and never broadcasts unauthorized document data.
128. Reconnect retrieves missed persistent notifications from the database; realtime transport is not the source of truth.
129. Notification read state is per user and persistent.
130. Report calculations use defined field semantics, stable timezone handling, and the same scoped query basis as the UI.
131. PDF and XLSX are the required core report formats; CSV is not a substitute for XLSX.
132. Export generation protects against spreadsheet formula injection and unsafe filenames.
133. The printable routing slip and exported reports are generated from authoritative server data, not client-only representative state.
134. ARTA classifications support recorded simple, complex, and highly technical working-day targets; holiday-calendar behavior must be configured/validated before compliance claims.
135. Local development is a Docker Compose stack including client, API, PostgreSQL, and the chosen local file-storage dependency.
136. The organization-hosted pilot is separate from local development and uses separately managed secrets, persistent volumes/storage, backups, and TLS ingress.
137. Automated tests cover the workflow state machine, authorization scope, immutable versions, audit atomicity, notifications, exports, and critical API paths.

### MVP boundary, pilot, delivery, and policy decisions (138–151)

138. The MVP is one complete predefined-workflow vertical slice, not a collection of disconnected screens or endpoints.
139. The MVP covers both incoming registration and the outgoing path needed to complete release and archival within the predefined workflow.
140. The MVP includes secure immutable file versions; a mutable upload directory alone does not satisfy acceptance.
141. The MVP includes metadata search and the recorded filters, sorting, and pagination needed for pilot work.
142. The MVP includes PDF and XLSX core reports plus the printable routing slip.
143. The MVP includes persistent realtime in-app notifications with unread/read behavior and reconnect catch-up.
144. The MVP includes role-and-scope enforcement for Records Office and one pilot division, including section assignment and read-only access.
145. The MVP includes local Docker Compose development and a separate organization-hosted pilot environment.
146. Pilot readiness requires end-to-end acceptance by the Records Office and one division using agreed scenarios and representative data.
147. Pilot readiness requires automated backup plus a successfully timed and evidenced recovery rehearsal for database and file/version storage.
148. Security and operations work needed to prevent obvious loss, unauthorized access, or evidence mutation is MVP work; broader hardening is explicitly phased later.
149. Estimates assume one full-stack developer at 20–25 hours/week and reserve 20–30% contingency rather than imposing a fixed deadline.
150. Emergency evidence retention/hold behavior remains an unresolved question and must not be silently implemented as ordinary archive/delete behavior.
151. Indefinite audit retention is not yet an approved operational rule; retention duration, legal basis, storage budget, access, and disposal require organizational policy validation.

## MVP acceptance boundary

### Included in MVP

- Approved account onboarding, authentication, inactivity handling, and deactivation.
- Role/capability plus division/section/document scope for Records Office and one pilot division.
- Incoming and outgoing registration, required metadata, generated identifiers, predefined legal transitions, revision, signature record, release, archive, and restore.
- Atomic routing, assignment, transition, audit, and persistent notification behavior.
- Multiple attachments with immutable file versions, safe preview/download, digest verification, and no overwrite path.
- Metadata search, filters, sort, pagination, dashboard, document timeline, and audit investigation views.
- Persistent realtime notifications, unread count, mark-read, and reconnect catch-up.
- Monthly/core operational reports in PDF and XLSX and branded printable routing slips.
- Accessible/responsive core screens and reduced-motion behavior.
- Docker Compose local environment and a separate organization-hosted pilot.
- Automated critical-path checks, end-to-end acceptance, observability basics, backup automation, and a demonstrated recovery.

### Later-phase security and operations enhancements

These items are valuable but are not allowed to displace the complete MVP slice unless pilot risk assessment makes one mandatory:

- Multi-factor authentication and organization single sign-on.
- Centralized access-token deny-list/instant access-token revocation beyond short expiry.
- Enterprise malware/CDR platform beyond the MVP scan-or-quarantine control.
- Dedicated secrets manager, automated key rotation, and managed certificate lifecycle where the pilot platform does not already provide them.
- Tamper-evident external audit anchoring/WORM retention beyond database immutability controls.
- SIEM integration, advanced anomaly detection, security alerting, and formal incident-response automation.
- High availability, multi-node failover, cross-site disaster recovery, geo-replication, and zero-downtime deployment.
- Queued report generation, caching, dedicated search infrastructure, and performance scaling beyond measured pilot needs.
- Email/SMS/push notification channels, notification preferences, digests, and escalation rules.
- Configurable workflow designer, ad-hoc workflows, electronic-signature provider integration, OCR, and content search.
- Broader organization rollout, multi-organization tenancy, archival tiering, and records-disposition automation.
- Mature operational dashboards, synthetic monitoring, SLO/error-budget practice, and 24×7 on-call processes.

### Policy gates and unresolved questions

- **Emergency evidence retention/hold:** Deferred. The organization must define who can place/release a hold, what objects it covers, how it overrides normal archive/disposition, what approvals and notifications apply, and how the action is audited.
- **Audit retention:** “Indefinite” must not be treated as a settled requirement. Legal/records owners must validate the retention schedule, lawful basis, access rules, cost, backup implications, and authorized disposal process.
- **Holiday/SLA calendar:** Weekend-only calculations are insufficient for a formal compliance claim. The authoritative holiday/workday calendar and ownership of updates require approval.
- **Signature meaning:** The MVP records an authorized signature action. A cryptographic or regulated electronic-signature provider requires a separate policy and integration decision.
- **Organization structure and branding:** Final division/section names, document types, reference formats, release methods, seal asset, report layout, and pilot users require Records Office sign-off before configuration is frozen.

## Delivery assumptions

- One full-stack developer contributes 20–25 hours per week.
- The 25-week phase plan represents roughly 500–625 hours at the stated weekly capacity. A 20–30% contingency reserve adds roughly 100–190 hours, consumed where risk materializes rather than automatically spent.
- Indicative elapsed range is therefore about 29–32 active development weeks at a sustainable average, with a wider 24–41-week mathematical range depending on weekly capacity and contingency actually consumed. This is a forecast, not a deadline.
- A week may slide without changing sequence. Phase exit criteria, not calendar dates, authorize dependent work.
- Existing code is reused only after tests establish its behavior; representative UI data and README claims are not acceptance evidence.
- Organization staff provide a product owner/Records Office representative, one pilot-division representative, and an infrastructure contact for timely reviews.

## Dependency-aware implementation roadmap

### Phase 0 — Evidence baseline and delivery controls (Weeks 1–2)

**Week 1 — Reconcile and baseline (20–25h)**

- Inventory the prior API, UI, migrations, tests, Docker assets, and known gaps against Decisions 1–151.
- Run the existing build, lint, tests, migrations, and Compose stack; record failures without weakening checks.
- Convert the workflow into an executable transition/guard matrix and draft acceptance scenarios for one representative incoming-to-archive journey plus outgoing release.
- Create a requirements traceability list from decision → implementation area → test → pilot evidence.

**Week 2 — Foundations and pilot inputs (20–25h)**

- Establish development/test configuration, migration discipline, fixtures, CI checks, and a disposable test database.
- Confirm pilot division, organization structure, roles, document types, identifiers, release methods, branding owner, and pilot hosting constraints.
- Draft the threat/data classification review and backup/recovery objectives with the infrastructure contact.
- Spike the organization-compatible binary storage and realtime transport only far enough to remove feasibility risk.

**Exit criteria:** Existing state is reproducible; gaps are explicit; acceptance scenarios and critical configuration inputs have named owners; no unresolved foundation choice blocks data modeling.

### Phase 1 — Domain, schema, authorization, and workflow core (Weeks 3–5)

**Week 3 — Data model and migrations (20–25h)**

- Model divisions, sections, placements, roles/capabilities, account requests, Documents, attachments/file versions, assignments/shares, workflow events, audit events, notifications, and outbox if used.
- Write forward migrations and safe local reset/fixture tooling.
- Add database constraints for identifiers, state invariants, file-version immutability fields, and referential integrity.

**Week 4 — Authentication and scope (20–25h)**

- Complete account request/approval/direct creation, login/refresh/logout, inactivity behavior, profile photo, deactivation, and session revocation.
- Centralize deny-by-default capability and organizational-scope predicates.
- Test cross-division, cross-section, viewer, Records Office, confidential-record, deactivated-user, and direct-object-reference cases.

**Week 5 — Workflow engine and concurrency (20–25h)**

- Implement the exact predefined states, allowed transitions, required remarks/evidence, archive/restore, and allowed-next-action response.
- Add optimistic locking or equivalent conflict protection.
- Commit workflow/custody changes, audit, notification/outbox records atomically.

**Dependencies:** Phase 0 configuration decisions precede schema freeze; authorization predicates precede every document/file/report endpoint.

**Exit criteria:** Migration from a clean database passes; the workflow matrix and scope matrix pass unit/integration tests; illegal or concurrent actions cannot corrupt state/history.

### Phase 2 — Secure document and immutable-file vertical slice (Weeks 6–9)

**Week 6 — Registration and identifiers (20–25h)**

- Implement incoming/outgoing creation and validation, metadata edits, external incoming reference retention, and unique division-based outgoing references.
- Add server pagination, basic filters/sort, and foundational indexes.

**Week 7 — Immutable file storage (20–25h)**

- Implement multipart upload with limits, media allow-list, server-generated keys, digest, metadata, and authorization.
- Store each replacement as a new immutable File version; remove all overwrite/update/delete paths for committed versions.
- Handle storage/database partial failure with transactional staging or reconciliation.

**Week 8 — Safe file use and revision (20–25h)**

- Implement version list/current-version selection, authorized preview/download, safe headers, and digest verification.
- Connect For Revision/resubmission to a new version and tie signature records to a specific version.
- Add scan-or-quarantine integration/operational control appropriate to the approved pilot host.

**Week 9 — Complete workflow actions (20–25h)**

- Implement route, multi-division forward/collaboration, section assignment/acceptance, signature record, release guards/method, archive, and restore.
- Complete Document detail/timeline APIs and audit coverage for each action.
- Run the first automated end-to-end vertical-slice test through the API.

**Dependencies:** Storage choice and grants follow Phase 0; file authorization follows Phase 1 scope; signature/release guards depend on immutable versions.

**Exit criteria:** A real file travels from intake through revision/signature/release/archive/restore without overwriting evidence; unauthorized file and workflow access is denied and tested.

### Phase 3 — Working UI, search, timeline, and accessibility (Weeks 10–13)

**Week 10 — API integration shell (20–25h)**

- Replace representative client data with authenticated API adapters, guarded navigation, consistent loading/empty/error states, and correlation-friendly error feedback.
- Implement account request/login/session expiry and role-aware application shell.

**Week 11 — Daily document work (20–25h)**

- Build registration/edit forms, incoming/outgoing lists, filters/sort/pagination, dashboard acceptance/assignment, and allowed action controls.
- Validate both client and server while keeping server decisions authoritative.

**Week 12 — Detail, files, workflow, and audit (20–25h)**

- Build detail/timeline, version history, safe inline preview/download, routing/forwarding, revision, signature, release, archive/restore, and remarks interactions.
- Build admin audit filtering and account/organization management required for pilot setup.

**Week 13 — Accessibility and responsive hardening (20–25h)**

- Complete keyboard navigation, focus management, semantic/status announcements, reduced motion, responsive layouts, and usable print styling.
- Test with representative long titles, empty values, large lists, errors, and narrow screens.

**Dependencies:** UI workflow controls consume Phase 1 allowed-next-action output; file UI consumes Phase 2 authorization/version APIs.

**Exit criteria:** Records and pilot-division users can complete the vertical slice in the browser without placeholder data or administrative workarounds.

### Phase 4 — Search, realtime notifications, and reports (Weeks 14–17)

**Week 14 — Metadata search and operational views (20–25h)**

- Complete scoped metadata search across agreed fields plus all recorded filters, sort, and pagination.
- Tune indexes using representative data/query plans; finalize dashboard counts, overdue indicators, and recent activity.

**Week 15 — Persistent realtime notifications (20–25h)**

- Implement persistent assignment/workflow notifications, unread count, list, mark-read, authenticated realtime channel, reconnect/catch-up, and outbox retry if selected.
- Test duplicate delivery, disconnect, restart, authorization changes, and deactivated accounts.

**Week 16 — Core reports (20–25h)**

- Define and test monthly incoming/outgoing/FOI/special-order calculations and scoped detail data.
- Generate branded PDF and safe XLSX outputs with stable timezone/date semantics.

**Week 17 — Routing slip and report validation (20–25h)**

- Complete branded printable routing slip from authoritative timeline data.
- Reconcile report totals against seeded source rows and test formula-injection, filename, empty-period, and large-result cases.

**Dependencies:** Search/report queries reuse Phase 1 scope predicates and Phase 2/3 metadata; realtime depends on persistent notification transactions.

**Exit criteria:** Search and report totals reconcile to known fixtures; PDF/XLSX/routing slip outputs are approved in sample form; notifications survive refresh/reconnect/restart.

### Phase 5 — System hardening and local release candidate (Weeks 18–20)

**Week 18 — Security and failure-path review (20–25h)**

- Verify upload/download, IDOR, scope, CORS/headers, rate limits, lockout, secret handling, log minimization, spreadsheet injection, and error responses.
- Confirm runtime database/storage permissions prevent audit/file-version mutation.

**Week 19 — Reliability and data-volume checks (20–25h)**

- Exercise concurrency, duplicate requests, transaction rollback, outbox retry, storage failure, database restart, and representative pilot dataset performance.
- Resolve measured bottlenecks without speculative infrastructure.

**Week 20 — Local release candidate (20–25h)**

- Finalize Docker Compose client/API/database/local-storage stack, health checks, migrations, seed/demo fixtures, and operator/developer instructions.
- Run full automated tests, production client build, API lint/static checks, migration rehearsal, and local end-to-end suite.

**Dependencies:** All MVP feature paths must be complete before hardening results are meaningful.

**Exit criteria:** A tagged/reproducible local release candidate passes the traceability matrix with no unresolved critical/high issue and no placeholder pilot behavior.

### Phase 6 — Organization-hosted pilot and recovery proof (Weeks 21–23)

**Week 21 — Pilot deployment (20–25h)**

- Provision the separate organization-hosted environment with TLS, unique secrets, least-privilege database/storage identities, persistent storage, migration procedure, and restricted administrative access.
- Configure final pilot organization structure, branding, reference formats, users, and representative baseline data.

**Week 22 — Backup, restore, and observability (20–25h)**

- Automate database and file/version backups with aligned retention and failure alerts.
- Restore into an isolated environment, verify record/version counts and sampled digests, measure recovery time, and preserve evidence.
- Confirm health checks, structured logs, rotation, disk/capacity checks, and support/runbook paths.

**Week 23 — Technical pilot rehearsal (20–25h)**

- Run the full acceptance pack on the hosted environment, including disconnect/reconnect, authorization boundaries, reports, and a post-restore vertical slice.
- Fix deployment-only issues and freeze the pilot release candidate.

**Dependencies:** Infrastructure contact, approved hostname/TLS, storage, backup target, and secrets must be available before Week 21.

**Exit criteria:** Hosted release works independently of local development; backup and recovery are demonstrated, timed, and signed off technically.

### Phase 7 — User acceptance, contingency, and handover (Weeks 24–25+, as needed)

**Week 24 — Records Office acceptance (20–25h)**

- Facilitate role-based acceptance using real working scenarios: incoming registration, assignment, revision/versioning, signature, outgoing release, search, reports, routing slip, notifications, archive/restore, and audit investigation.
- Capture severity, owner, evidence, and retest expectation for each finding.

**Week 25 — Pilot division acceptance and handover (20–25h)**

- Repeat scope-specific acceptance with the pilot division, including attempted out-of-scope access and mobile/keyboard use.
- Complete operator, administrator, Records Office, user quick-start, backup/recovery, deployment/rollback, and support documentation.
- Record policy deferrals and later-phase backlog without silently treating them as accepted risks.

**Contingency — 20–30% across or after phases**

- Reserve roughly 5–8 developer-weeks (100–190h), equivalent to 20–30% of the 25-week phase plan, for discovered legacy defects, review turnaround, data/configuration correction, infrastructure access, security fixes, performance tuning, UAT findings, and recovery rehearsal issues.
- Consume contingency where the dependency occurs; do not wait until the end while knowingly carrying a blocking defect.

**Final MVP exit criteria:** Records Office and one division sign off the end-to-end scenarios; critical authorization/evidence-loss defects are closed; PDF/XLSX and routing slip are accepted; realtime notifications are persistent; production-like backup/recovery evidence exists; operational ownership and known policy gaps are documented.

## Validation strategy and evidence

- **Unit:** State machine, guards, number generation, due-date calculations, report calculations, scope predicates, and serialization/sanitization.
- **Integration:** Authentication/session lifecycle, account approval, every document transition, atomic audit/notification behavior, immutable version rules, upload failure cleanup, search scope, and export authorization.
- **End-to-end:** Role-specific browser journeys for Records Office, division head, section staff, viewer, and administrator across the complete vertical slice.
- **Security:** Cross-scope/IDOR attempts, deactivated sessions, login abuse, upload/preview/download controls, confidential records, export injection, runtime database grants, and secret/log inspection.
- **Reliability:** Concurrent actions, retry/idempotency behavior, database/storage interruption, realtime reconnect, application restart, and backup restore with digest sampling.
- **Performance:** Representative pilot data and agreed concurrent pilot activity; measure search/list/dashboard/report response and export memory/runtime before optimization.
- **Acceptance evidence:** Decision-to-test traceability, test outputs, approved sample exports/slip, UAT scripts/results, defect/retest log, deployment record, and recovery report.

## Known prior-project gaps to address

The available project is a useful prototype, not the MVP baseline. Recorded gaps include:

- Its state machine omits explicit For Revision and Signed states and treats Archived as terminal without restore.
- Its attachment model represents one mutable stored file record rather than an immutable logical attachment/version hierarchy with digest.
- Its UI uses representative data rather than end-to-end API integration.
- Its notification API persists list/read state but does not establish authenticated realtime delivery and reconnect reconciliation.
- Core PDF/XLSX reports are not implemented; CSV placeholders are not sufficient.
- Organization structure is partly hard-coded and contains placeholder/inconsistent division labels.
- Existing tests cover only the state machine and basic health/404 behavior, far below the required acceptance and security coverage.
- Local Compose exists, but separate pilot hosting, backup automation, and evidenced recovery are not yet established.

These gaps guide the roadmap; they do not change the agreed target.
