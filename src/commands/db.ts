import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { executeSql, projectRef } from '../db/client.js';

export async function dbInitCommand() {
  const ref = projectRef();
  console.log(`→ Running migration on Supabase project: ${ref}`);

  const migration = await readFile(resolve(process.cwd(), 'supabase/migrations/0001_siteharvest.sql'), 'utf8');
  await executeSql(migration);

  console.log('✓ SiteHarvest database schema created/updated.');
}
