create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  base_url text not null unique,
  name text,
  technologies jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crawls (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  status text not null default 'running' check (status in ('running','completed','failed','cancelled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages_seen integer not null default 0,
  products_found integer not null default 0,
  errors integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists pages (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  url text not null unique,
  canonical_url text,
  title text,
  description text,
  content_type text,
  technologies jsonb not null default '[]'::jsonb,
  raw_html text,
  content_hash text,
  last_crawled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists technologies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  name text not null,
  slug text,
  parent_id uuid references categories(id) on delete set null,
  parent_name text,
  source_url text not null,
  breadcrumbs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, name, source_url)
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  source_page_id uuid references pages(id) on delete set null,
  canonical_url text not null,
  name text not null,
  brand text,
  description text,
  sku text,
  barcode text,
  price numeric,
  currency text,
  availability text,
  manufacturer text,
  form text,
  package_size text,
  image_urls jsonb not null default '[]'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(name,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(brand,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description,'')), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, canonical_url)
);

create table if not exists product_categories (
  product_id uuid not null references products(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  primary key(product_id, category_id)
);

create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  persian_name text,
  aliases jsonb not null default '[]'::jsonb,
  ingredient_type text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_ingredients (
  product_id uuid not null references products(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  amount numeric,
  unit text,
  form text,
  raw_name text,
  primary key(product_id, ingredient_id)
);

create table if not exists crawl_errors (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) on delete cascade,
  url text,
  error_type text,
  message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_pages_source on pages(source_id);
create index if not exists idx_pages_canonical on pages(canonical_url);
create index if not exists idx_products_source on products(source_id);
create index if not exists idx_products_name_trgm on products using gin(name gin_trgm_ops);
create index if not exists idx_products_brand_trgm on products using gin(brand gin_trgm_ops);
create index if not exists idx_products_search_vector on products using gin(search_vector);
create index if not exists idx_products_barcode on products(barcode);
create index if not exists idx_categories_source on categories(source_id);
create index if not exists idx_product_ingredients_ingredient on product_ingredients(ingredient_id);

create or replace function search_products(search_query text, result_limit integer default 20)
returns table (
  id uuid,
  name text,
  brand text,
  description text,
  rank real
)
language sql
stable
as $$
  select p.id, p.name, p.brand, p.description,
         ts_rank_cd(p.search_vector, plainto_tsquery('simple', search_query)) as rank
  from products p
  where p.search_vector @@ plainto_tsquery('simple', search_query)
     or p.name % search_query
     or coalesce(p.brand,'') % search_query
  order by rank desc, similarity(p.name, search_query) desc
  limit greatest(result_limit, 1);
$$;
