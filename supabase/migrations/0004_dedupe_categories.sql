-- Fix category deduplication: change unique constraint from (source_id, name, source_url) to (source_id, name)
-- This allows breadcrumb categories to be shared across products

-- Step 1: Find canonical categories (oldest per source_id + name)
create temp table temp_canonical_categories as
select distinct on (source_id, name) id as canonical_id, source_id, name
from categories
order by source_id, name, created_at asc;

-- Step 2: Update product_categories to point to canonical categories
update product_categories pc
set category_id = c.canonical_id
from (
  select c.id as dup_id, ca.canonical_id
  from categories c
  join temp_canonical_categories ca on c.source_id = ca.source_id and c.name = ca.name
  where c.id != ca.canonical_id
) c
where pc.category_id = c.dup_id;

-- Step 3: Deduplicate product_categories (remove duplicate product_id + category_id pairs)
delete from product_categories
where ctid not in (
  select min(ctid)
  from product_categories
  group by product_id, category_id
);

-- Step 4: Delete duplicate categories
delete from categories
where id in (
  select c.id
  from categories c
  join temp_canonical_categories ca on c.source_id = ca.source_id and c.name = ca.name
  where c.id != ca.canonical_id
);

-- Step 5: Clean up temp table
drop table temp_canonical_categories;

-- Step 6: Drop the old unique constraint
alter table categories drop constraint if exists categories_source_id_name_source_url_key;

-- Step 7: Add new unique constraint on (source_id, name) only (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'categories_source_id_name_key'
  ) then
    alter table categories add constraint categories_source_id_name_key unique (source_id, name);
  end if;
end $$;