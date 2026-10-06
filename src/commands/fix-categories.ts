import { Command } from "commander";
import { supabaseClient } from "../db/client.js";

export async function fixCategoriesCommand(sourceId: string) {
  const supabase = supabaseClient();

  console.log(`🔧 Fixing categories for source ${sourceId}...`);

  // Step 1: Find canonical categories (oldest per source_id + name)
  const { data: allCats, error: catsErr } = await supabase
    .from('categories')
    .select('id, source_id, name, created_at')
    .eq('source_id', sourceId)
    .order('name')
    .order('created_at', { ascending: true });

  if (catsErr) throw new Error(`Failed to fetch categories: ${catsErr.message}`);

  // Group by name, keep oldest
  const canonical = new Map<string, string>(); // name -> canonical_id
  const duplicates = new Map<string, string>(); // dup_id -> canonical_id

  for (const cat of allCats ?? []) {
    if (!canonical.has(cat.name)) {
      canonical.set(cat.name, cat.id);
    } else {
      duplicates.set(cat.id, canonical.get(cat.name)!);
    }
  }

  console.log(`Found ${canonical.size} unique category names`);
  console.log(`Found ${duplicates.size} duplicate categories to merge`);

  if (duplicates.size === 0) {
    console.log('No duplicates to fix.');
    return;
  }

  // Step 2: Update product_categories in batches
  const dupEntries = Array.from(duplicates.entries());
  let updated = 0;
  
  for (const [dupId, canonicalId] of dupEntries) {
    const { error } = await supabase
      .from('product_categories')
      .update({ category_id: canonicalId })
      .eq('category_id', dupId);

    if (error) {
      console.error(`Failed to update ${dupId}:`, error.message);
    } else {
      updated++;
    }
  }

  console.log(`Updated ${updated} product_categories links`);

  // Step 3: Deduplicate product_categories (remove duplicate product_id + category_id pairs)
  const { data: pcLinks, error: pcErr } = await supabase
    .from('product_categories')
    .select('product_id, category_id')
    .eq('product_id', '8e869f22-3bc6-44a2-953b-5c96f65a729d'); // test with one

  if (pcErr) console.error('Error:', pcErr);

  // Find all duplicates in product_categories
  const { data: allPc } = await supabase
    .from('product_categories')
    .select('product_id, category_id');

  const pcMap = new Map<string, string[]>(); // product_id -> category_ids[]
  for (const pc of allPc ?? []) {
    const key = `${pc.product_id}|${pc.category_id}`;
    if (!pcMap.has(key)) pcMap.set(key, []);
    pcMap.get(key)!.push(key);
  }

  // Actually, let's use SQL for the dedupe since it's more efficient
  console.log('Deduplicating product_categories table...');
  
  // Use raw SQL for the dedupe
  const dedupeSql = `
    delete from product_categories
    where ctid not in (
      select min(ctid)
      from product_categories
      group by product_id, category_id
    );
  `;
  
  // We'll do this via the executeSql function
  const { executeSql } = await import('../db/client.js');
  await executeSql(dedupeSql);
  console.log('Deduplicated product_categories');

  // Step 4: Delete duplicate categories
  console.log('Deleting duplicate categories...');
  let deleted = 0;
  for (const [dupId, canonicalId] of dupEntries) {
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', dupId);
    
    if (error) {
      console.error(`Failed to delete ${dupId}:`, error.message);
    } else {
      deleted++;
    }
  }
  console.log(`Deleted ${deleted} duplicate categories`);

  // Step 5: Drop old constraint and add new one
  console.log('Updating constraints...');
  await executeSql(`
    alter table categories drop constraint if exists categories_source_id_name_source_url_key;
    alter table categories add constraint categories_source_id_name_key unique (source_id, name);
  `);
  console.log('✓ Constraints updated');

  // Verify
  const { count } = await supabase.from('categories').select('*', { count: 'exact', head: true }).eq('source_id', sourceId);
  console.log(`\nCategories remaining: ${count}`);
}

export function fixCategoriesCli(program: Command) {
  program
    .command('fix-categories <source-id>')
    .description('One-time fix: merge duplicate categories by name (keeps oldest), update product_categories links, deduplicate product_categories, and add unique constraint on (source_id, name). Run after db:init if you have existing duplicate categories.')
    .action(async (sourceId) => {
      await fixCategoriesCommand(sourceId);
    });
}