import { createPool, migrateUp, seedReferenceData, type Pool } from '../src/index.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://arrive:arrive_dev@127.0.0.1:5432/arrive_audit_test';

/** Drops everything in the test database and rebuilds it from the migrations + seeds. */
export async function freshDatabase(): Promise<Pool> {
  const pool = createPool(TEST_DATABASE_URL, 5);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrateUp(pool);
  await seedReferenceData(pool);
  return pool;
}
