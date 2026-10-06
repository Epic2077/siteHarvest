import { executeSql } from './src/db/client.js';
import 'dotenv/config';

async function main() {
  // First, let's see the current state
  const { data: cats } = await executeSql(`
    select name, count(*) as cnt
    from categories
    where source_id = '3017b32d-2b2c-4847-9983-da9f58722eca'
    group by name
    having count(*) > 1
    order by cnt desc
  `);
  console.log('Duplicate category names:', cats);

  // Deduplicate product_categories first
  console.log('\nDeduplicating product_categories...');
  await executeSql(`
    delete from product_categories
    where ctid not in (
      select min(ctid)
      from product_categories
      group by product_id, category_id
    );
  `);
  console.log('Done');

  // Now for each duplicate category name, keep the oldest and delete others
  console.log('\nDeleting duplicate categories...');
  await executeSql(`
    with canonical as (
      select distinct on (source_id, name) id as canonical_id, source_id, name
      from categories
      where source_id = '3017b32d-2b2c-4847-9983-da9f58722eca'
      order by source_id, name, created_at asc
    ),
    duplicates as (
      select c.id
      from categories c
      join canonical ca on c.source_id = ca.source_id and c.name = ca.name
      where c.id != ca.canonical_id
    )
    delete from categories
    where id in (select id from duplicates);
  `);
  console.log('Done');

  // Verify
  const { data: cats2 } = await executeSql(`
    select name, count(*) as cnt
    from categories
    where source_id = '3017b32d-2b2c-4847-9983-da9f58722eca'
    group by name
    having count(*) > 1
  `);
  console.log('\nRemaining duplicates:', cats2);

  const { data: count } = await executeSql(`
    select count(*) from categories where source_id = '3017b32d-2b2c-4847-9983-da9f58722eca'
  `);
  console.log('Total categories:', count);

  // Add constraint
  console.log('\nAdding unique constraint...');
  await executeSql(`
    alter table categories drop constraint if exists categories_source_id_name_source_url_key;
    alter table categories add constraint categories_source_id_name_key unique (source_id, name);
  `);
  console.log('Done!');
}

main().catch(console.error);