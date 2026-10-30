import { appliedMigrations, loadMigrations, migrateDown, migrateUp } from './migrate.js';
import { createPool } from './pool.js';
import { seedReferenceData } from './seed.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const [cmd = 'status', ...flags] = process.argv.slice(2);
const pool = createPool(url, 2);
try {
  if (cmd === 'up') {
    const applied = await migrateUp(pool);
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'nothing to apply');
  } else if (cmd === 'down') {
    const stepsArg = flags.find((f) => f.startsWith('--steps='));
    const reverted = await migrateDown(pool, { steps: stepsArg ? Number(stepsArg.split('=')[1]) : 1, force: flags.includes('--force') });
    console.log(reverted.length ? `reverted: ${reverted.join(', ')}` : 'nothing to revert');
  } else if (cmd === 'seed') {
    await seedReferenceData(pool);
    console.log('reference data seeded');
  } else if (cmd === 'status') {
    const done = new Set((await appliedMigrations(pool)).map((m) => m.version));
    for (const m of loadMigrations()) console.log(`${done.has(m.version) ? '[x]' : '[ ]'} ${m.version}_${m.name}`);
  } else {
    console.error(`unknown command: ${cmd} (use up | down [--steps=N] [--force] | seed | status)`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
