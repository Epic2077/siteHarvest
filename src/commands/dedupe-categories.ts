import { Command } from "commander";
import { supabaseClient } from "../db/client.js";

export async function dedupeCategoriesCommand(
  sourceId: string,
  options: { dryRun?: boolean; byNameOnly?: boolean }
) {
  const supabase = supabaseClient();

  console.log(`🔍 Finding duplicate categories for source ${sourceId}...`);

  const { data: cats, error } = await supabase
    .from('categories')
    .select('id, source_id, name, source_url, slug, parent_name, breadcrumbs, created_at, updated_at')
    .eq('source_id', sourceId)
    .order('name')
    .order('source_url')
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch categories: ${error.message}`);

  // Group by source_id + name + source_url (exact duplicates)
  const exactKey = (c: typeof cats[0]) => `${c.source_id}|${c.name}|${c.source_url}`;
  // Group by source_id + name only (same name, different URLs)
  const nameKey = (c: typeof cats[0]) => `${c.source_id}|${c.name}`;

  const groups = new Map<string, typeof cats>();
  const keyFn = options.byNameOnly ? nameKey : exactKey;

  for (const cat of cats ?? []) {
    const key = keyFn(cat);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(cat);
  }

  let duplicateGroups = 0;
  let totalDuplicates = 0;
  let processed = 0;

  for (const [key, catList] of groups) {
    if (catList.length <= 1) continue;

    duplicateGroups++;
    totalDuplicates += catList.length - 1;

    // Keep the oldest (first), merge others into it
    const [canonical, ...dups] = catList;

    console.log(`\nGroup: ${canonical.name}${options.byNameOnly ? '' : ` (${canonical.source_url})`}`);
    console.log(`  Canonical: ${canonical.id} (created: ${canonical.created_at})`);
    
    for (const dup of dups) {
      console.log(`  Duplicate: ${dup.id}${options.byNameOnly ? ` | ${dup.source_url}` : ''} (created: ${dup.created_at})`);

      if (!options.dryRun) {
        // Update product_categories to point to canonical
        const { error: updateErr } = await supabase
          .from('product_categories')
          .update({ category_id: canonical.id })
          .eq('category_id', dup.id);

        if (updateErr) {
          console.error(`    Failed to update product_categories: ${updateErr.message}`);
          continue;
        }

        // Delete duplicate category
        const { error: deleteErr } = await supabase
          .from('categories')
          .delete()
          .eq('id', dup.id);

        if (deleteErr) {
          console.error(`    Failed to delete duplicate: ${deleteErr.message}`);
        } else {
          console.log(`    ✓ Merged ${dup.id} → ${canonical.id}`);
          processed++;
        }
      }
    }
  }

  console.log(`\n${options.dryRun ? 'DRY RUN: ' : ''}Found ${duplicateGroups} duplicate groups, ${totalDuplicates} duplicate categories`);
  console.log(`${options.dryRun ? 'Would merge' : 'Merged'}: ${processed} duplicates`);

  if (options.dryRun) {
    console.log('\nRun without --dry-run to apply changes.');
  }
}

export function dedupeCategoriesCli(program: Command) {
  program
    .command('dedupe-categories <source-id>')
    .description('Deduplicate categories by source_id+name+source_url (exact duplicates), preserving product_categories links. Use --by-name-only to also merge same-name categories across different URLs (collapses breadcrumb hierarchy).')
    .option('--dry-run', 'Show what would be done without making changes', true)
    .option('--by-name-only', 'Deduplicate by name only (ignores source_url) - collapses hierarchy', false)
    .action(async (sourceId, options) => {
      await dedupeCategoriesCommand(sourceId, { dryRun: options.dryRun, byNameOnly: options.byNameOnly });
    });
}