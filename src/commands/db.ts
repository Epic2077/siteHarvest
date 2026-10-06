import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { executeSql, projectRef } from '../db/client.js';

export async function dbInitCommand() {
  const ref = projectRef();
  console.log(`→ Running migration on Supabase project: ${ref}`);

  const migrationDirectory = resolve(process.cwd(), 'supabase/migrations');
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const migration = await readFile(resolve(migrationDirectory, file), 'utf8');
    await executeSql(migration);
    console.log(`  ✓ ${file}`);
  }

  console.log('✓ SiteHarvest database schema created/updated.');
}
