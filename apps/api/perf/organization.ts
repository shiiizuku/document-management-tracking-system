import { ACCOUNTS, DIVISIONS, SECTIONS } from '../../e2e/fixtures/accounts.js';

/**
 * The pilot-sized organization: the end-to-end suite's tree, widened to a whole regional office.
 *
 * The end-to-end tree (`apps/e2e/fixtures/accounts.ts`) is kept **verbatim, ids and passwords
 * included**, and extended rather than replaced. That is what lets the load test (D2) sign in as
 * the same five principals the acceptance scenarios name, and lets an E2E screen be pointed at
 * this data without a second set of fixtures — `docs/phase-7-sequencing.md` asked for exactly that
 * reuse instead of inventing another tree.
 *
 * The divisions added here are the shape of a regional office, not its real names: decision
 * register 356 holds the final division and section names until the Records Unit signs them off.
 * What matters for a plan is the *count* — how many units scope has to discriminate between, and
 * how thinly the documents are spread across them.
 */

export interface PerfDivision {
  id: string;
  code: string;
  name: string;
}
export interface PerfSection {
  id: string;
  divisionId: string;
  code: string;
  name: string;
}

// Ids in their own namespace (`…-a000-…`) so they can never collide with the E2E fixtures'
// (`…-9000-…`), which this tree contains.
const id = (n: number): string => `00000000-0000-4000-a000-${n.toString(16).padStart(12, '0')}`;

const ADDED_DIVISIONS: readonly (PerfDivision & {
  sections: readonly { code: string; name: string }[];
})[] = [
  {
    id: id(0x101),
    code: 'MMD',
    name: 'Mine Management Division',
    sections: [
      { code: 'PERMITS', name: 'Permits Section' },
      { code: 'TENEMENTS', name: 'Tenements Section' },
    ],
  },
  {
    id: id(0x102),
    code: 'GEO',
    name: 'Geosciences Division',
    sections: [
      { code: 'MAPPING', name: 'Mapping Section' },
      { code: 'HAZARDS', name: 'Geohazards Section' },
    ],
  },
  {
    id: id(0x103),
    code: 'FAD',
    name: 'Finance and Administrative Division',
    sections: [
      { code: 'ACCOUNTING', name: 'Accounting Section' },
      { code: 'PERSONNEL', name: 'Personnel Section' },
    ],
  },
  {
    id: id(0x104),
    code: 'MSESDD',
    name: 'Mine Safety, Environment and Social Development Division',
    sections: [
      { code: 'SAFETY', name: 'Safety Section' },
      { code: 'ENVIRONMENT', name: 'Environment Section' },
    ],
  },
  {
    id: id(0x105),
    code: 'LEGAL',
    name: 'Legal Division',
    sections: [{ code: 'CASES', name: 'Cases Section' }],
  },
];

// The E2E tree has one section in PILOT and none in LANDS; a second each, so every working
// division has both a section path and a division-level path for scope to tell apart.
const ADDED_SECTIONS_IN_FIXTURE_DIVISIONS: readonly PerfSection[] = [
  { id: id(0x201), divisionId: DIVISIONS.pilot.id, code: 'ADMIN', name: 'Administrative Section' },
  { id: id(0x202), divisionId: DIVISIONS.lands.id, code: 'SURVEY', name: 'Survey Section' },
];

export const PERF_DIVISIONS: readonly PerfDivision[] = [
  ...Object.values(DIVISIONS),
  ...ADDED_DIVISIONS.map(({ id: divisionId, code, name }) => ({ id: divisionId, code, name })),
];

export const PERF_SECTIONS: readonly PerfSection[] = [
  ...Object.values(SECTIONS),
  ...ADDED_SECTIONS_IN_FIXTURE_DIVISIONS,
  ...ADDED_DIVISIONS.flatMap((division, d) =>
    division.sections.map((section, s) => ({
      id: id(0x300 + d * 0x10 + s),
      divisionId: division.id,
      code: section.code,
      name: section.name,
    })),
  ),
];

/**
 * The shared password of every generated account. Local-only, like every fixture password in the
 * repository, and exported so the load test can sign in as any of them. The five E2E principals
 * keep their own passwords from `accounts.ts`.
 */
export const LOAD_ACCOUNT_PASSWORD = 'PilotLoad1234!';

export interface PerfAccount {
  id: string;
  email: string;
  displayName: string;
  role: 'ADMINISTRATOR' | 'RECORDS_STAFF' | 'DIRECTOR' | 'DIVISION_HEAD' | 'STAFF_MEMBER';
  divisionId: string | null;
  sectionId: string | null;
  canAccessConfidential: boolean;
}

/**
 * Staff per section. A regional office of this shape runs at roughly 150–200 accounts; twelve per
 * section across eighteen sections, plus heads and records staff, lands inside that.
 */
export const STAFF_PER_SECTION = 12;
const EXTRA_RECORDS_STAFF = 3;

const fixtureDivisionHeads = new Set<string>(
  Object.values(ACCOUNTS)
    .filter((account) => account.role === 'DIVISION_HEAD')
    .map((account) => account.divisionId ?? ''),
);

export const generatedAccounts = (): PerfAccount[] => {
  const accounts: PerfAccount[] = [];
  let n = 0;
  const next = () => id(0x10000 + n++);
  const codeOf = (divisionId: string) =>
    PERF_DIVISIONS.find((division) => division.id === divisionId)?.code.toLowerCase() ?? 'x';

  for (const division of PERF_DIVISIONS) {
    if (division.id === DIVISIONS.ord.id || fixtureDivisionHeads.has(division.id)) continue;
    accounts.push({
      id: next(),
      email: `load.${division.code.toLowerCase()}.head@dts.local`,
      displayName: `${division.name} Head`,
      role: 'DIVISION_HEAD',
      divisionId: division.id,
      sectionId: null,
      canAccessConfidential: false,
    });
  }
  for (const section of PERF_SECTIONS) {
    const isRecords = section.id === SECTIONS.records.id;
    const count = isRecords ? EXTRA_RECORDS_STAFF : STAFF_PER_SECTION;
    for (let i = 1; i <= count; i++)
      accounts.push({
        id: next(),
        email: `load.${codeOf(section.divisionId)}.${section.code.toLowerCase()}.${i}@dts.local`,
        displayName: `${section.name} ${isRecords ? 'Records Officer' : 'Staff'} ${i}`,
        role: isRecords ? 'RECORDS_STAFF' : 'STAFF_MEMBER',
        divisionId: section.divisionId,
        sectionId: section.id,
        canAccessConfidential: isRecords,
      });
  }
  return accounts;
};
