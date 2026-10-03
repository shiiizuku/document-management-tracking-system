import { hash } from 'bcryptjs';
import { config } from 'dotenv';
import { createDatabase } from './client.js';
import { ORD_DIVISION_CODE } from '../modules/organization/organization.constants.js';
import { divisions, sections, users } from './schema.js';

config({ path: new URL('../../../../.env', import.meta.url) });

const { db, pool } = createDatabase();
try {
  const [recordsDivision] = await db
    .insert(divisions)
    .values({ code: 'RECORDS', name: 'Records Office' })
    .onConflictDoUpdate({ target: divisions.code, set: { name: 'Records Office' } })
    .returning();
  /*
   * The Office of the Regional Director. Seeded as its own division so the Director has a
   * placement: ADR-0006 makes a `DIRECTOR` account a deployment-ordering constraint rather than a
   * convenience, because release is gated on a signature record and nobody else may sign.
   *
   * Decision 152 makes the Records Unit a Section *inside* the ORD. That restructure is not done
   * here — the Records Office above is still its own division — so this row is additive and moves
   * no existing user. Folding the two together is the remaining half of decision 152.
   */
  const [ordDivision] = await db
    .insert(divisions)
    .values({ code: ORD_DIVISION_CODE, name: 'Office of the Regional Director' })
    .onConflictDoUpdate({
      target: divisions.code,
      set: { name: 'Office of the Regional Director' },
    })
    .returning();
  const [pilotDivision] = await db
    .insert(divisions)
    .values({ code: 'PILOT', name: 'Pilot Division' })
    .onConflictDoUpdate({ target: divisions.code, set: { name: 'Pilot Division' } })
    .returning();
  if (!recordsDivision || !pilotDivision || !ordDivision)
    throw new Error('Unable to seed divisions');
  const [intakeSection] = await db
    .insert(sections)
    .values({ divisionId: recordsDivision.id, code: 'INTAKE', name: 'Intake' })
    .onConflictDoUpdate({
      target: [sections.divisionId, sections.name],
      set: { code: 'INTAKE', active: true, updatedAt: new Date() },
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
  // `||`, not `??`: compose passes an unset variable through as an empty string, and an empty
  // administrator password must fall back to the default rather than be hashed.
  const passwordHash = await hash(process.env.SEED_ADMIN_PASSWORD || 'Admin@12345!', 12);
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
  if (intakeSection)
    await db
      .insert(users)
      .values({
        email: 'records@dts.local',
        displayName: 'Records Officer',
        passwordHash: await hash('Records@1234!', 12),
        role: 'RECORDS_STAFF',
        divisionId: recordsDivision.id,
        sectionId: intakeSection.id,
        canAccessConfidential: true,
      })
      .onConflictDoNothing();
  /*
   * The signatory. No outgoing document can be released without one, so a fresh database that
   * skipped this account would register and route correspondence perfectly and then stall at
   * `FOR_SIGNATURE` with no account able to clear it.
   *
   * Placed in the ORD with no section: `DIRECTOR` needs a division and must not be narrowed to a
   * section, and its office-wide read scope comes from the role rather than the placement.
   */
  await db
    .insert(users)
    .values({
      email: 'director@dts.local',
      displayName: 'Regional Director',
      passwordHash: await hash('Director@1234!', 12),
      role: 'DIRECTOR',
      divisionId: ordDivision.id,
      canAccessConfidential: true,
    })
    .onConflictDoNothing();
  if (pilotSection)
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
