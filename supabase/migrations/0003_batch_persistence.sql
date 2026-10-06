-- Follow-up for databases where the original 0002 migration was already applied.
-- Idempotently adds partition storage and installs the current durable queue RPCs.

alter table pages add column if not exists content_text text;
alter table pages add column if not exists partitions jsonb not null default '[]'::jsonb;

create index if not exists idx_crawl_urls_ready
  on crawl_urls(crawl_id, status, next_attempt_at)
  where status in ('pending', 'processing');

create index if not exists idx_crawl_urls_crawl_status
  on crawl_urls(crawl_id, status);

-- Atomic claim: grab N pending URLs and mark them processing with a lease.
-- Uses FOR UPDATE SKIP LOCKED for safe concurrent claiming.
create or replace function claim_crawl_urls(
  p_crawl_id uuid,
  p_limit integer default 1,
  p_lease_seconds integer default 300
)
returns setof crawl_urls
language sql
as $$
  update crawl_urls
  set status = 'processing',
      locked_at = now(),
      lock_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
      attempts = attempts + 1
  where id in (
    select id from crawl_urls
    where crawl_id = p_crawl_id
      and status in ('pending', 'failed')
      and next_attempt_at <= now()
      and attempts < max_attempts
    order by discovered_at
    limit p_limit
    for update skip locked
  )
  returning *;
$$;

-- Persist a fetched batch and advance its queue items in one transaction/RPC.
-- A failed call leaves queue leases intact so the batch can be reclaimed safely.
create or replace function persist_crawl_batch(
  p_crawl_id uuid,
  p_source_id uuid,
  p_results jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  result jsonb;
  page_data jsonb;
  product_data jsonb;
  category_data jsonb;
  ingredient_data jsonb;
  discovered_url text;
  category_name text;
  page_id uuid;
  v_product_id uuid;
  category_id uuid;
  v_ingredient_id uuid;
  completed_count integer := 0;
  product_count integer := 0;
  error_count integer := 0;
begin
  for result in select value from jsonb_array_elements(p_results)
  loop
    if result->>'status' = 'completed' then
      page_data := result->'page';
      insert into pages (
        source_id, url, canonical_url, title, description, content_type,
        technologies, raw_html, content_hash, content_text, partitions,
        last_crawled_at, updated_at
      ) values (
        p_source_id, page_data->>'url', coalesce(page_data->>'canonicalUrl', page_data->>'url'),
        page_data->>'title', page_data->>'description', 'text/html',
        coalesce(page_data->'technologies', '[]'::jsonb), page_data->>'rawHtml',
        page_data->>'contentHash', page_data->>'textContent',
        coalesce(page_data->'partitions', '[]'::jsonb), now(), now()
      )
      on conflict (url) do update set
        source_id = excluded.source_id,
        canonical_url = excluded.canonical_url,
        title = excluded.title,
        description = excluded.description,
        technologies = excluded.technologies,
        raw_html = excluded.raw_html,
        content_hash = excluded.content_hash,
        content_text = excluded.content_text,
        partitions = excluded.partitions,
        last_crawled_at = now(),
        updated_at = now()
      returning id into page_id;

      category_data := page_data->'category';
      if category_data is not null and category_data <> 'null'::jsonb then
        insert into categories (source_id, name, slug, parent_name, source_url, breadcrumbs, updated_at)
        values (
          p_source_id, category_data->>'name', category_data->>'slug', category_data->>'parentName',
          category_data->>'sourceUrl', coalesce(category_data->'breadcrumbs', '[]'::jsonb), now()
        )
        on conflict (source_id, name, source_url) do update set
          slug = excluded.slug, parent_name = excluded.parent_name,
          breadcrumbs = excluded.breadcrumbs, updated_at = now();
      end if;

      product_data := page_data->'product';
      if product_data is not null and product_data <> 'null'::jsonb then
        insert into products (
          source_id, source_page_id, canonical_url, name, brand, description,
          sku, barcode, price, currency, availability, manufacturer, form,
          package_size, image_urls, attributes, source_payload, updated_at
        ) values (
          p_source_id, page_id, product_data->>'canonicalUrl', product_data->>'name',
          product_data->>'brand', product_data->>'description', product_data->>'sku',
          product_data->>'barcode', nullif(product_data->>'price', '')::numeric,
          product_data->>'currency', product_data->>'availability', product_data->>'manufacturer',
          product_data->>'form', product_data->>'packageSize',
          coalesce(product_data->'imageUrls', '[]'::jsonb),
          coalesce(product_data->'attributes', '{}'::jsonb), product_data, now()
        )
        on conflict (source_id, canonical_url) do update set
          source_page_id = excluded.source_page_id, name = excluded.name, brand = excluded.brand,
          description = excluded.description, sku = excluded.sku, barcode = excluded.barcode,
          price = excluded.price, currency = excluded.currency, availability = excluded.availability,
          manufacturer = excluded.manufacturer, form = excluded.form,
          package_size = excluded.package_size, image_urls = excluded.image_urls,
          attributes = excluded.attributes, source_payload = excluded.source_payload, updated_at = now()
        returning id into v_product_id;

        for category_name in select jsonb_array_elements_text(coalesce(product_data->'categoryNames', '[]'::jsonb))
        loop
          insert into categories (source_id, name, source_url, breadcrumbs)
          values (p_source_id, category_name, page_data->>'url', coalesce(product_data->'breadcrumbs', '[]'::jsonb))
          on conflict (source_id, name, source_url) do update set breadcrumbs = excluded.breadcrumbs, updated_at = now()
          returning id into category_id;
          insert into product_categories (product_id, category_id) values (v_product_id, category_id)
          on conflict do nothing;
        end loop;

        for ingredient_data in select value from jsonb_array_elements(coalesce(product_data->'ingredients', '[]'::jsonb))
        loop
          insert into ingredients (canonical_name, metadata, updated_at)
          values (ingredient_data->>'name', jsonb_build_object('source', 'raw-extraction'), now())
          on conflict (canonical_name) do update set updated_at = now()
          returning id into v_ingredient_id;
          insert into product_ingredients (product_id, ingredient_id, amount, unit, form, raw_name)
          values (
            v_product_id, v_ingredient_id, nullif(ingredient_data->>'amount', '')::numeric,
            ingredient_data->>'unit', ingredient_data->>'form', ingredient_data->>'name'
          )
          on conflict (product_id, ingredient_id) do update set
            amount = excluded.amount, unit = excluded.unit, form = excluded.form, raw_name = excluded.raw_name;
        end loop;
        product_count := product_count + 1;
      end if;

      for discovered_url in select jsonb_array_elements_text(coalesce(result->'discoveredUrls', '[]'::jsonb))
      loop
        insert into crawl_urls (crawl_id, url, normalized_url)
        values (p_crawl_id, discovered_url, discovered_url)
        on conflict (crawl_id, normalized_url) do nothing;
      end loop;

      update crawl_urls set status = 'completed', status_code = nullif(result->>'statusCode', '')::integer,
        completed_at = now(), locked_at = null, lock_expires_at = null, error = null
      where id = (result->>'queueId')::uuid and crawl_id = p_crawl_id;
      completed_count := completed_count + 1;
    elsif result->>'status' = 'skipped' then
      update crawl_urls set status = 'skipped', status_code = nullif(result->>'statusCode', '')::integer,
        completed_at = now(), locked_at = null, lock_expires_at = null
      where id = (result->>'queueId')::uuid and crawl_id = p_crawl_id;
    else
      update crawl_urls set status = 'failed', status_code = nullif(result->>'statusCode', '')::integer,
        error = left(result->>'error', 1000),
        next_attempt_at = now() + (least(power(4, attempts), 900)::text || ' seconds')::interval,
        locked_at = null, lock_expires_at = null
      where id = (result->>'queueId')::uuid and crawl_id = p_crawl_id;
      error_count := error_count + 1;
    end if;
  end loop;

  update crawls set
    pages_seen = pages_seen + completed_count,
    products_found = products_found + product_count,
    errors = errors + error_count
  where id = p_crawl_id;

  return jsonb_build_object('completed', completed_count, 'products', product_count, 'errors', error_count);
end;
$$;

revoke execute on function persist_crawl_batch(uuid, uuid, jsonb) from public;
grant execute on function persist_crawl_batch(uuid, uuid, jsonb) to service_role;

-- Release stale leases (processing URLs whose lock expired).
create or replace function release_stale_locks(p_crawl_id uuid)
returns integer
language plpgsql
as $$
declare
  cnt integer;
begin
  with released as (
    update crawl_urls
    set status = 'pending', locked_at = null, lock_expires_at = null
    where crawl_id = p_crawl_id
      and status = 'processing'
      and lock_expires_at < now()
    returning id
  )
  select count(*)::integer into cnt from released;
  return cnt;
end;
$$;

-- Count URLs by status for a crawl (for progress reporting).
create or replace function crawl_url_counts(p_crawl_id uuid)
returns table(status text, count bigint)
language sql
as $$
  select cu.status, count(*) from crawl_urls cu
  where cu.crawl_id = p_crawl_id
  group by cu.status;
$$;

create or replace function crawl_queue_state(p_crawl_id uuid)
returns table(retryable bigint, processing bigint, next_attempt_at timestamptz)
language sql
stable
as $$
  select
    count(*) filter (where status in ('pending', 'failed') and attempts < max_attempts),
    count(*) filter (where status = 'processing'),
    min(cu.next_attempt_at) filter (where status in ('pending', 'failed') and attempts < max_attempts)
  from crawl_urls cu
  where cu.crawl_id = p_crawl_id;
$$;

revoke execute on function claim_crawl_urls(uuid, integer, integer) from public;
revoke execute on function release_stale_locks(uuid) from public;
revoke execute on function crawl_url_counts(uuid) from public;
revoke execute on function crawl_queue_state(uuid) from public;
grant execute on function claim_crawl_urls(uuid, integer, integer) to service_role;
grant execute on function release_stale_locks(uuid) to service_role;
grant execute on function crawl_url_counts(uuid) to service_role;
grant execute on function crawl_queue_state(uuid) to service_role;
