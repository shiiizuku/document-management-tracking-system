# Acceptance scenarios

_Slice 0.1 deliverable. Written 2026-10-04, against the organization structure migration `0009`
settled (the Records Unit is a Section inside the ORD — decision 152) and the configurable release
methods of migration `0010` (policy register P-15)._

Two journeys, given/when/then: one incoming letter from arrival to archive, and one outgoing letter
from draft to release. They are written to be **performed by hand, through the browser, by someone
who has not read the code** — every actor is a named account, every control is named by the label
printed on it, and every expected result is something visible on screen.

They are also the script the Playwright suite transcribes (`apps/e2e/tests/`). That is the point of
writing them first: the automated flow should be a transcription, not a second design.

> Where a step says _nothing happens yet_, that is an assertion, not an aside. Most of what this
> system is for is refusing to let a document move before the right person has touched it.

## Preconditions

### The organization

| Division                           | Code    | Sections            |
| ---------------------------------- | ------- | ------------------- |
| Office of the Regional Director    | `ORD`   | Records Unit        |
| Pilot Division                     | `PILOT` | General Section     |
| Lands Management Division          | `LANDS` | —                   |

There is no standalone `RECORDS` division: the Records Unit is a Section of the ORD. This matters to
the outgoing journey, because an outgoing draft **owned by the ORD** skips the division head's
initial (ADR-0007) and one owned by any other division does not. Both are covered below.

### The accounts

| Account             | Display name         | Role            | Placement             | Why it exists here                             |
| ------------------- | -------------------- | --------------- | --------------------- | ---------------------------------------------- |
| `records@dts.local` | Records Officer      | `RECORDS_STAFF` | ORD · Records Unit    | Registers incoming mail, releases, archives    |
| `staff@dts.local`   | Pilot Staff          | `STAFF_MEMBER`  | PILOT · General       | Acts on what is routed to the section          |
| `head@dts.local`    | Pilot Division Head  | `DIVISION_HEAD` | PILOT (no section)    | Drafts outgoing correspondence, records initial |
| `director@dts.local`| Regional Director    | `DIRECTOR`      | ORD (no section)      | **The only signatory** (ADR-0006)              |
| `lands.head@dts.local` | Lands Division Head | `DIVISION_HEAD` | LANDS (no section)    | Receives the for-information copy              |
| `admin@dts.local`   | System Administrator | `ADMINISTRATOR` | unplaced              | Audit trail, users, divisions                  |

**The Director is needed for exactly one hop** and holds nothing else: `DOCUMENT_SIGN` and
`REPORT_VIEW`, and no `DOCUMENT_INITIAL` (ADR-0006 separates the endorsement from the signature;
granting both to one account would make the initial ceremonial). An executor who signs in as the
Director expecting to also prepare the release will find no button, and that is correct.

The local development passwords are in `apps/e2e/fixtures/accounts.ts`. In a pilot the Director's
account is deployment configuration — `DIRECTOR_EMAIL` / `DIRECTOR_PASSWORD` — and the API refuses
to boot in production without it.

---

## Scenario 1 · An incoming letter, from arrival to archive

A letter arrives at the Records Unit, is scanned, is forwarded to the division that has to act on
it with a second division copied in for information, is acted upon, and is closed.

### 1.1 Registration confers no custody

**Given** I am signed in as `records@dts.local`
**And** I am on **Documents**

**When** I press **Register document** and fill in

| Field     | Value                                            |
| --------- | ------------------------------------------------ |
| Title     | `Request for certified true copy of survey plan` |
| Direction | `Incoming`                                       |
| Type      | `Letter`                                         |
| Division  | `Office of the Regional Director`                |
| Sender    | `Provincial Assessor, Benguet`                   |

**And** I open the optional section and set **Section** to `Records Unit`
**And** I press **Register document**

**Then** the new document opens, its tracking number reading `DTS-<this year>-000001`
**And** the rail's status is **Pending** — not _In process_

> Registration is not acceptance (decision 154). Saving the document writes an unaccepted handoff
> to the unit it was registered for, and that unaccepted row is what _Pending_ means. A document
> that appeared already in hand would be a document nobody had taken responsibility for.
>
> **Found by performing this step:** the rail used to badge the stored column, which is
> `IN_PROCESS` from creation, so it read _In process_ beside an **Accept custody** button. Fixed
> (`presentedStatus`). The registry and _My work_ rows still badge the column, because a list row
> carries no routes — an open gap, not something to assert here.

**And** the reference number column is blank — an incoming letter carries the sender's reference if
they printed one, never one of ours (decisions 168–169).

### 1.2 Nothing moves before the holding unit takes it on

**When** I open the document

**Then** the rail says **Currently with · Office of the Regional Director**
**And** the only button under **Available actions** is **Accept custody**

> This is the assertion that matters most in this scenario. Decision 155: nothing moves until the
> unit holding the document has taken it on, so _Record compliance_, _Forward_ and _Archive_ are
> all unreachable while the handoff is outstanding — even for an account that holds every one of
> those capabilities.

**When** I press **Accept custody**

**Then** the status becomes **In process**
**And** the timeline gains **Accepted by Office of the Regional Director**

### 1.3 The scan is uploaded and is not downloadable until it is clean

**When** I press **Upload file** under **Attachments** and choose a PDF

**Then** the new version appears with the badge **Scan pending**
**And** there is no **Download** button beside it

> No buttons at all rather than disabled ones: the file genuinely cannot be served yet. Fail-closed
> is the posture (policy register P-07), and it is proven against real ClamAV in
> `apps/api/test/scanner.int.test.ts`.

**When** I reload the page after the scanner has reported

**Then** the badge reads **Clean**
**And** a **Download** button is now beside it

> **Reload is required, and that is a finding rather than a step.** The scan verdict is written by
> the worker and no realtime message is published for it, so the badge does not change under an
> open page. Recorded here because an executor will otherwise sit watching an unchanging badge.

### 1.4 The forward names one lead and any number of informed copies

**When** I press **Forward** and choose

| Field                            | Value                             |
| -------------------------------- | --------------------------------- |
| Receiving division               | `Pilot Division`                  |
| Copy in for information          | `Lands Management Division`       |
| Remarks                          | `For action. Reply within 7 days.` |

**And** I submit

**Then** the rail says **Currently with · Pilot Division**
**And** the status is **Pending** again
**And** the timeline shows **Forwarded to Pilot Division** _and_ **Copied to Lands Management
Division for information**, the second drawn as a hollow dot rather than a filled one

> Exactly one recipient is the lead and takes custody; the rest may read and remark and are never
> waited on (decision 24 as amended, ADR-0005, decisions 159–160). The hollow dot is the screen
> saying that a copy is not custody.

**And** signing in as `lands.head@dts.local` shows the document in that division's registry, with
**Accept custody** absent — there is nothing for an informed division to accept — and
**Acknowledge copy** offered instead

**When** the Lands head presses **Acknowledge copy**
**Then** the timeline shows **Acknowledged by Lands Management Division**, drawn as a copy
**And** **Currently with** still reads **Pilot Division**: acknowledging is not custody

> Acknowledging is how an informed division says it has read the copy. Until it does, the copy is
> outstanding and the document counts as **Pending**; it never blocks the lead (decision 160). It
> may be done before or after the lead accepts.

### 1.5 The lead acts on it, with remarks

**Given** I am signed in as `staff@dts.local`

**When** I open the document from **Documents**
**Then** the only available action is **Accept custody**

**When** I press **Accept custody**
**Then** the status becomes **In process**
**And** **Record compliance** is now offered

**When** I press **Record compliance**, enter the remark `Certified copy issued and released to the
requesting office`, and confirm

**Then** the status becomes **Complied**
**And** the remark is on the timeline

> An incoming document terminates by being acted upon **with remarks** (decision 163): the remark
> is the record of what was actually done about it, so it is evidence and the server refuses the
> action without one.

### 1.6 Closing the record

**Given** I am signed in as `records@dts.local`

**When** I open the document and press **Archive**

**Then** the status becomes **Archived**
**And** the document appears under **Archive** in the sidebar
**And** **Forward** and the metadata editor are gone — a closed record's files and fields no longer
change
**And** **Print routing slip** is still offered, because a closed record is exactly the one whose
printable dossier people still need (decision 170).

**And** the outstanding information copy to Lands never blocked any of this.

---

## Scenario 2 · An outgoing letter, from draft to release

The Pilot Division drafts a reply. It is endorsed by its head, **signed by the Regional Director**,
prepared, released by courier with a consignment number, and archived.

### 2.1 Registration allocates the office's own reference

**Given** I am signed in as `head@dts.local`

**When** I press **Register document** and fill in

| Field     | Value                                        |
| --------- | -------------------------------------------- |
| Title     | `Reply to request for certified true copy`   |
| Direction | `Outgoing`                                   |
| Type      | `Letter`                                     |
| Division  | `Pilot Division`                             |

**And** I leave **Section** unset
**And** I press **Register document**

**Then** the document's **Reference number** is `PILOT-<this year>-00001`

> An outgoing document is stamped with an office reference allocated per division and year, inside
> the same transaction that allocates the tracking number. The division code is embedded in it
> permanently, which is why a division is deactivated and never deleted (decision 153).

**Leave the section unset.** A division head sits in no section, and a handoff addressed to a
section can only be accepted from inside that section — registering into `General Section` would
produce a draft its own author cannot accept.

### 2.2 The draft is taken on and the draft file uploaded

**When** I press **Accept custody**
**Then** the status becomes **In process**

**When** I upload the draft as a PDF and reload until the badge reads **Clean**
**Then** a **Download** button is beside it

### 2.3 The division head's initial

**Then** **Record initial** is offered

**When** I press **Record initial**
**Then** the status becomes **For initial**

**When** I press **Submit for signature**
**Then** the status becomes **For signature**

> Two acts by two authorities. The initial is the division head's endorsement, taken _before_ the
> Director signs (ADR-0006); `DOCUMENT_INITIAL` is held by `DIVISION_HEAD` and by nobody else.

### 2.4 The Director signs — and does only that

**Given** I am signed in as `director@dts.local`

**When** I open the document from **Documents**

**Then** **Record signature** is the **only** available action

> The Director reads every division's work — the only placed role that does, because it must review
> anything it is asked to sign — and can do nothing else to it. This is the step fixtures get wrong:
> the outgoing path needs a Director actor for exactly one hop and then needs a different actor.

**When** I press **Record signature**

**Then** the status becomes **Signed**
**And** the signature is recorded against the attachment version that was current at that moment.

**And** no action is offered to me any more. Sign out.

### 2.5 Release requires that the signed file is still the current one

**Given** I am signed in as `records@dts.local`

**When** I open the document and press **Prepare release**
**Then** the status becomes **For release**

**When** I press **Release document**
**Then** a dialog asks for a **Delivery method**, offering `Emailed`, `Postal`, `LBC`, `JRS`,
`Picked up` and `Personally delivered`

> Six configured rows, not a four-value enum. LBC and JRS are the couriers the office actually
> uses and could not be recorded at all until migration `0010`; a seventh carrier is now an
> `INSERT` rather than a migration (policy register P-15, decision 27 as amended).

**When** I choose `LBC`
**Then** a required **LBC tracking reference** field appears

> The requirement is a property of the method, not of the action: LBC and JRS issue a consignment
> number and are flagged as requiring one. Choosing `Picked up` makes the field disappear, and the
> server **refuses** a tracking reference against an unflagged method — a tracking number against
> "Picked up" asserts that something can be traced when it cannot.

**When** I enter `LBC-2026-884411` and confirm

**Then** the status becomes **Released**
**And** the detail page shows **Released by · LBC** and **Tracking reference · LBC-2026-884411**

**When** I press **Archive**
**Then** the status becomes **Archived**

### 2.6 Variant · an ORD-drafted letter skips the initial

Repeat 2.1–2.3 as `records@dts.local`, registering the outgoing document into **Office of the
Regional Director · Records Unit**.

**Then** **Record initial** is **not** offered, and **Submit for signature** is available directly
from **In process**
**And** the reference number reads `ORD-<this year>-00001`

> The ORD is itself a division that registers outgoing correspondence, and its head _is_ the
> Director — so requiring an initial there would have one person perform both acts, which is
> exactly what ADR-0006 separated. ADR-0007 is that exemption, and placing the records officer
> inside the ORD (migration `0009`) is what makes it reachable without hand-editing rows.

---

## What must not happen

Negative assertions worth performing, because each is a rule that is invisible when it works.

| Attempt                                                            | Expected                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `staff@dts.local` opens a document registered in another division   | **This document is not available** — a 404 and a 403 read alike, because saying a tracking number exists is itself a disclosure |
| Downloading an attachment whose badge is not **Clean**              | No download control exists; the endpoint refuses                     |
| `director@dts.local` tries to prepare the release                   | No such button; the capability is not held                           |
| Releasing an outgoing document after uploading a newer version      | Refused: the current clean attachment must be the signed one         |
| Two people acting on one document from stale pages                  | The second gets **This document changed — review and retry**         |
| A `VIEWER` attempting any action                                    | Nothing is offered and every command is refused                      |

## Where these are automated

| Scenario            | Spec                                       |
| ------------------- | ------------------------------------------ |
| 1 · incoming        | `apps/e2e/tests/incoming-archive.spec.ts`  |
| 2 · outgoing        | `apps/e2e/tests/outgoing-release.spec.ts`  |
| 2.6 · ORD variant   | `apps/e2e/tests/outgoing-release.spec.ts`  |

The negative assertions are mostly covered already, and more cheaply, at the REST layer:
`apps/api/test/authorization.test.ts` (30 cases, including the confidentiality gate and the
Director's office-wide read), `apps/api/test/scanner.int.test.ts` (fail-closed download against
real ClamAV) and `apps/api/test/documents.int.test.ts` (optimistic-concurrency conflicts).
