import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { config } from 'dotenv';
import { createDatabase } from './client.js';
import {
  seedsDemoAccounts,
  validateDirectorAccount,
  validateSeedAdminPassword,
} from '../config/environment.js';
import { ORD_DIVISION_CODE } from '../modules/organization/organization.constants.js';
import { divisions, sections, users } from './schema.js';

const MGB_REGION_3_DIVISIONS = [
  {
    code: 'MMD',
    name: 'Mine Management Division',
    sections: [
      { code: 'MTSS', name: 'Monitoring and Technical Services Section' },
      { code: 'MTES', name: 'Mining Tenement Evaluation Section' },
      { code: 'MLSS', name: 'Mineral Lands Survey Section' },
    ],
  },
  {
    code: 'MSESDD',
    name: 'Mine Safety, Environment and Social Development Division',
    sections: [
      { code: 'MSHS', name: 'Mine Safety and Health Section' },
      { code: 'MEMS', name: 'Mine Environmental Management Section' },
      { code: 'SDS', name: 'Social Development Section' },
    ],
  },
  {
    code: 'GD',
    name: 'Geosciences Division',
    sections: [
      { code: 'GHEGS', name: 'Geohazard and Engineering Geology Section' },
      { code: 'GENEGS', name: 'General and Economic Geology Section' },
      { code: 'HEGS', name: 'Hydrogeology and Environmental Geology Section' },
    ],
  },
  {
    code: 'FAD',
    name: 'Finance and Administrative Division',
    sections: [
      { code: 'FIN', name: 'Finance Section' },
      { code: 'ADMIN', name: 'Administrative Section' },
    ],
  },
] as const;

config({ path: new URL('../../../../.env', import.meta.url) });

/*
 * Decided before a connection is opened. `validateDirectorAccount` throws when a production
 * deployment has configured no Director, and a seed that failed halfway would leave an
 * organization tree with no signatory in it — which is the state ADR-0006 exists to prevent.
 */
const director = validateDirectorAccount(process.env);
// Likewise: unset in production throws, rather than seeding the README's administrator password.
const seedAdminPassword = validateSeedAdminPassword(process.env);
// The records and staff accounts below have passwords published in the README, so only a
// development database gets them; a production one is staffed through the administrator.
const demoAccounts = seedsDemoAccounts(process.env);

const { db, pool } = createDatabase();
try {
  /*
   * The Office of the Regional Director, with the **Records Unit as a Section inside it**
   * (decision 152, completed by migration 0009). There is no standalone `RECORDS` division any
   * more: an existing one is deactivated rather than deleted by that migration, because division
   * codes are embedded in reference numbers already issued on paper (decision 153).
   *
   * Placing the records officer here is what makes ADR-0007's exemption reachable without
   * hand-editing rows — a draft it registers is owned by the ORD, so it goes straight to
   * `FOR_SIGNATURE` rather than collecting the Director's own initial first.
   */
  const [ordDivision] = await db
    .insert(divisions)
    .values({ code: ORD_DIVISION_CODE, name: 'Office of the Regional Director' })
    .onConflictDoUpdate({
      target: divisions.code,
      set: { name: 'Office of the Regional Director', active: true },
    })
    .returning();
  const [pilotDivision] = await db
    .insert(divisions)
    .values({ code: 'PILOT', name: 'Pilot Division' })
    .onConflictDoUpdate({ target: divisions.code, set: { name: 'Pilot Division' } })
    .returning();
  if (!ordDivision || !pilotDivision) throw new Error('Unable to seed divisions');
  // "Records Unit", not "Records Office": `docs/CONTEXT.md` retires the latter, because "Office"
  // now means the ORD.
  const [recordsSection] = await db
    .insert(sections)
    .values({ divisionId: ordDivision.id, code: 'RECORDS', name: 'Records Unit' })
    .onConflictDoUpdate({
      target: [sections.divisionId, sections.name],
      set: { code: 'RECORDS', active: true, updatedAt: new Date() },
    })
    .returning();
  const [pilotSection] = await db
    .insert(sections)
    .values({ divisionId: pilotDivision.id, code: 'GENERAL', name: 'General Section' })
    .onConflictDoUpdate({
      target: [sections.divisionId, sections.name],
      set: { code: 'GENERAL', active: true, updatedAt: new Date() },
    })
    .returning();
  /*
   * The regional office's own divisions and sections, as published in MGB Region III's
   * "Directory of Key Officials" (region3.mgb.gov.ph/directory-of-key-officials, read 2026-10-09).
   * The Director's Office there is the ORD above.
   *
   * Insert-if-missing, never update: an administrator may have renamed or retired one of these
   * since, and a re-run of the seed must not undo that. Division codes become the prefix of
   * reference numbers issued on paper (decision 153), so they are chosen once here and not
   * derived from the names.
   */
  for (const division of MGB_REGION_3_DIVISIONS) {
    await db
      .insert(divisions)
      .values({ code: division.code, name: division.name })
      .onConflictDoNothing();
    const [row] = await db.select().from(divisions).where(eq(divisions.code, division.code));
    // A division of the same name under another code was created by hand; leave it be.
    if (!row) continue;
    for (const section of division.sections)
      await db
        .insert(sections)
        .values({ divisionId: row.id, code: section.code, name: section.name })
        .onConflictDoNothing();
  }
  const passwordHash = await hash(seedAdminPassword ?? 'Admin@12345!', 12);
  await db
    .insert(users)
    .values({
      email: 'admin@dts.local',
      displayName: 'System Administrator',
      passwordHash,
      role: 'ADMINISTRATOR',
      canAccessConfidential: true,
    })
    .onConflictDoNothing();
  if (demoAccounts && recordsSection)
    await db
      .insert(users)
      .values({
        email: 'records@dts.local',
        displayName: 'Records Officer',
        passwordHash: await hash('Records@1234!', 12),
        role: 'RECORDS_STAFF',
        divisionId: ordDivision.id,
        sectionId: recordsSection.id,
        canAccessConfidential: true,
      })
      .onConflictDoNothing();
  /*
   * The signatory. No outgoing document can be released without one, so a fresh database that
   * skipped this account would register and route correspondence perfectly and then stall at
   * `FOR_SIGNATURE` with no account able to clear it.
   *
   * Which account it is comes from `DIRECTOR_EMAIL` / `DIRECTOR_PASSWORD` when they are set, and
   * from the development default only when they are not — which production can never reach,
   * because `validateDirectorAccount` refuses to return null there. That is the whole of A3:
   * `director@dts.local` and its repository-resident password are now a convenience for local
   * work, not something a pilot can inherit by forgetting to configure anything.
   *
   * Placed in the ORD with no section: `DIRECTOR` needs a division and must not be narrowed to a
   * section, and its office-wide read scope comes from the role rather than the placement.
   */
  const directorAccount = director ?? {
    email: 'director@dts.local',
    password: 'Director@1234!',
  };
  await db
    .insert(users)
    .values({
      email: directorAccount.email,
      displayName: 'Regional Director',
      passwordHash: await hash(directorAccount.password, 12),
      role: 'DIRECTOR',
      divisionId: ordDivision.id,
      canAccessConfidential: true,
    })
    .onConflictDoNothing();
  if (demoAccounts && pilotSection)
    await db
      .insert(users)
      .values({
        email: 'staff@dts.local',
        displayName: 'Pilot Staff',
        passwordHash: await hash('Staff@12345!', 12),
        role: 'STAFF_MEMBER',
        divisionId: pilotDivision.id,
        sectionId: pilotSection.id,
      })
      .onConflictDoNothing();
  process.stdout.write('Seed completed.\n');
} finally {
  await pool.end();
}
