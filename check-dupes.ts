import { supabaseClient } from './src/db/client.js';
const sb = supabaseClient();

const { data: cats, error } = await sb
  .from('categories')
  .select('id, name, source_url, source_id, created_at')
  .eq('source_id', '3017b32d-2b2c-4847-9983-da9f58722eca')
  .order('name')
  .order('created_at');

if (error) throw error;

// Group by name only
const byName = new Map<string, typeof cats>();
for (const cat of cats ?? []) {
  if (!byName.has(cat.name)) byName.set(cat.name, []);
  byName.get(cat.name)!.push(cat);
}

let dupes = 0;
for (const [name, list] of byName) {
  if (list.length > 1) {
    dupes++;
    console.log(`\n${name} (${list.length} entries):`);
    for (const c of list) {
      console.log(`  ${c.id} | ${c.source_url} | ${c.created_at}`);
    }
  }
}
console.log(`\nTotal duplicate names: ${dupes}`);

// Also check by source_url
const byUrl = new Map<string, typeof cats>();
for (const cat of cats ?? []) {
  if (!byUrl.has(cat.source_url)) byUrl.set(cat.source_url, []);
  byUrl.get(cat.source_url)!.push(cat);
}

let dupesUrl = 0;
for (const [url, list] of byUrl) {
  if (list.length > 1) {
    dupesUrl++;
    console.log(`\nURL: ${url} (${list.length} entries):`);
    for (const c of list) {
      console.log(`  ${c.id} | ${c.name} | ${c.created_at}`);
    }
  }
}
console.log(`\nTotal duplicate URLs: ${dupesUrl}`);