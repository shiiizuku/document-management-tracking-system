import { hash } from 'bcryptjs';
import { createDatabase } from './client.js';
import { divisions, sections, users } from './schema.js';

const { db, pool } = createDatabase();
try {
  const [recordsDivision] = await db
    .insert(divisions)
    .values({ code: 'RECORDS', name: 'Records Office' })
    .onConflictDoUpdate({ target: divisions.code, set: { name: 'Records Office' } })
    .returning();
  const [pilotDivision] = await db
    .insert(divisions)
    .values({ code: 'PILOT', name: 'Pilot Division' })
    .onConflictDoUpdate({ target: divisions.code, set: { name: 'Pilot Division' } })
    .returning();
  if (!recordsDivision || !pilotDivision) throw new Error('Unable to seed divisions');
  const [intakeSection] = await db
    .insert(sections)
    .values({ divisionId: recordsDivision.id, code: 'INTAKE', name: 'Intake' })
    .onConflictDoNothing()
    .returning();
  const [pilotSection] = await db
    .insert(sections)
    .values({ divisionId: pilotDivision.id, code: 'GENERAL', name: 'General Section' })
    .onConflictDoNothing()
    .returning();
  const passwordHash = await hash(process.env.SEED_ADMIN_PASSWORD ?? 'Admin@1234!', 12);
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
