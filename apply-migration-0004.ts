import { executeSql } from './src/db/client.js';
import { readFileSync } from 'fs';
import 'dotenv/config';

async function main() {
  const sql = readFileSync('./supabase/migrations/0004_dedupe_categories.sql', 'utf-8');
  console.log('Applying migration 0004_dedupe_categories.sql...');
  try {
    const result = await executeSql(sql);
    console.log('Migration applied successfully:', result);
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

main();