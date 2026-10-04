/**
 * The organization and the accounts every end-to-end spec is written against.
 *
 * Fixed UUIDs, deliberately. The session credential is a stateless JWT whose `sub` is the user's
 * id (ADR-0002), so a saved `storageState` is only valid while that id exists — and `POST
 * /auth/login` is rate limited to five calls a minute per client (decision register 68), which a
 * run that re-authenticated per spec would exhaust in its first minute. Pinning the ids lets the
 * whole run share one set of logins: the organization and these accounts are seeded once by
 * `global-setup.ts` and never touched again, while each spec truncates only the document side.
 *
 * The structure is the post-`0009` one (decision 152): the Records Unit is a **Section inside the
 * ORD**, and there is no standalone `RECORDS` division. `docs/acceptance-scenarios.md` is written
 * against the same table.
 */

export const DIVISIONS = {
  ord: {
    id: '00000000-0000-4000-9000-00000000e001',
    code: 'ORD',
    name: 'Office of the Regional Director',
  },
  pilot: {
    id: '00000000-0000-4000-9000-00000000e002',
    code: 'PILOT',
    name: 'Pilot Division',
  },
  // Exists to be copied in for information, which is a division-level act (decision 160). Its head
  // is seeded so the notification a copy writes has a recipient; see the login-budget note below
  // for why nobody signs in as it.
  lands: {
    id: '00000000-0000-4000-9000-00000000e003',
    code: 'LANDS',
    name: 'Lands Management Division',
  },
} as const;

export const SECTIONS = {
  // "Records Unit", not "Records Office": docs/CONTEXT.md retires the latter, because "Office" now
  // means the ORD.
  records: {
    id: '00000000-0000-4000-9000-00000000e011',
    divisionId: DIVISIONS.ord.id,
    code: 'RECORDS',
    name: 'Records Unit',
  },
  general: {
    id: '00000000-0000-4000-9000-00000000e012',
    divisionId: DIVISIONS.pilot.id,
    code: 'GENERAL',
    name: 'General Section',
  },
} as const;

export interface SeededAccount {
  id: string;
  email: string;
  password: string;
  displayName: string;
  role: 'ADMINISTRATOR' | 'RECORDS_STAFF' | 'DIRECTOR' | 'DIVISION_HEAD' | 'STAFF_MEMBER';
  divisionId: string | null;
  sectionId: string | null;
  canAccessConfidential: boolean;
}

/**
 * Every seeded account. The passwords are local-only fixtures and satisfy the same length bound
 * `loginSchema` enforces; a pilot's Director account is deployment configuration instead
 * (`DIRECTOR_EMAIL` / `DIRECTOR_PASSWORD`, ADR-0006).
 */
export const ACCOUNTS = {
  records: {
    id: '00000000-0000-4000-9000-00000000e021',
    email: 'records@dts.local',
    password: 'RecordsPass1234!',
    displayName: 'Records Officer',
    role: 'RECORDS_STAFF',
    divisionId: DIVISIONS.ord.id,
    sectionId: SECTIONS.records.id,
    canAccessConfidential: true,
  },
  staff: {
    id: '00000000-0000-4000-9000-00000000e022',
    email: 'staff@dts.local',
    password: 'StaffPass12345!',
    displayName: 'Pilot Staff',
    role: 'STAFF_MEMBER',
    divisionId: DIVISIONS.pilot.id,
    sectionId: SECTIONS.general.id,
    canAccessConfidential: false,
  },
  /*
   * A division head sits in a division and in **no section**, which is why the outgoing journey
   * registers its draft at division level: a handoff addressed to a section can only be accepted
   * from inside that section, so a draft registered into General Section would be one its own
   * author could not accept.
   */
  head: {
    id: '00000000-0000-4000-9000-00000000e023',
    email: 'head@dts.local',
    password: 'HeadPass123456!',
    displayName: 'Pilot Division Head',
    role: 'DIVISION_HEAD',
    divisionId: DIVISIONS.pilot.id,
    sectionId: null,
    canAccessConfidential: false,
  },
  /*
   * The sole signatory (ADR-0006). Placed in the ORD with no section, and holding only
   * `DOCUMENT_SIGN` and `REPORT_VIEW` — so the outgoing journey needs this actor for exactly one
   * hop and a different one either side of it. That is the step fixtures get wrong.
   */
  director: {
    id: '00000000-0000-4000-9000-00000000e024',
    email: 'director@dts.local',
    password: 'DirectorPass1234!',
    displayName: 'Regional Director',
    role: 'DIRECTOR',
    divisionId: DIVISIONS.ord.id,
    sectionId: null,
    canAccessConfidential: true,
  },
  admin: {
    id: '00000000-0000-4000-9000-00000000e025',
    email: 'admin@dts.local',
    password: 'AdminPass12345!',
    displayName: 'System Administrator',
    role: 'ADMINISTRATOR',
    divisionId: null,
    sectionId: null,
    canAccessConfidential: true,
  },
  /*
   * Seeded but **never signed in as** — see `SIGNED_IN_ROLES`. The for-information assertions read
   * the forwarding division's own timeline instead, exactly as `documents.int.test.ts` does for
   * the same reason.
   */
  landsHead: {
    id: '00000000-0000-4000-9000-00000000e026',
    email: 'lands.head@dts.local',
    password: 'LandsPass12345!',
    displayName: 'Lands Division Head',
    role: 'DIVISION_HEAD',
    divisionId: DIVISIONS.lands.id,
    sectionId: null,
    canAccessConfidential: false,
  },
} as const satisfies Record<string, SeededAccount>;

export type AccountKey = keyof typeof ACCOUNTS;

/**
 * The roles `auth.setup.ts` authenticates and saves a `storageState` for.
 *
 * **This list must not exceed five.** `POST /auth/login` is throttled to five requests a minute
 * per client, and the setup signs in back to back — a sixth role would be refused with a 429 and
 * the failure would surface as an unexplained setup error rather than as the budget decision it
 * is. `assertLoginBudget` below turns that into a readable failure if anyone adds one.
 *
 * If a spec ever genuinely needs a sixth principal, assert its side of the behaviour from the
 * other principal's screen, or from the database, rather than signing in.
 */
export const SIGNED_IN_ROLES = ['records', 'staff', 'head', 'director', 'admin'] as const;
export type SignedInRole = (typeof SIGNED_IN_ROLES)[number];

/** The per-minute login allowance in `AuthController`. Mirrored, not imported: a cross-package */
/** import would pull the whole API into the Playwright process to read one number. */
export const LOGIN_RATE_LIMIT = 5;

export const assertLoginBudget = (): void => {
  if (SIGNED_IN_ROLES.length > LOGIN_RATE_LIMIT)
    throw new Error(
      `auth.setup.ts would make ${SIGNED_IN_ROLES.length} logins in one minute, but ` +
        `POST /auth/login allows ${LOGIN_RATE_LIMIT}. Assert the extra principal's behaviour ` +
        'from another screen or from the database instead of signing in as it.',
    );
};
