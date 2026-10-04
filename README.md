# SiteHarvest

SiteHarvest is a TypeScript CLI for turning public website catalogs into a normalized, developer-friendly data source.

The first target is pharmacy/supplement catalogs for **Shiva**, but the architecture is intentionally generic enough to become a portfolio-grade website ingestion tool.

## What it does

- Detects likely website technologies from HTML, headers, scripts and metadata.
- Discovers category and product URLs.
- Extracts JSON-LD, OpenGraph, breadcrumbs, headings, tables and configurable selectors.
- Normalizes products/categories into a stable internal schema.
- Stores raw pages plus normalized records in Supabase/Postgres.
- Keeps source provenance so every normalized field can be traced back to a URL.
- Supports site-specific adapters without coupling the crawler to one website.
- Is designed to prefer structured APIs/JSON when discovered, then JSON-LD, then HTML extraction.

## Architecture

```text
URL
 │
 ├── Tech detector
 │      ├── Next.js / React
 │      ├── WordPress / WooCommerce
 │      ├── Shopify
 │      └── Generic
 │
 ├── Source adapter
 │      ├── discovery
 │      ├── category extraction
 │      └── product extraction
 │
 ├── Fetcher
 │      └── HTML / JSON
 │
 ├── Normalizer
 │      ├── canonical product
 │      ├── category tree
 │      └── ingredient normalization hooks
 │
 └── Supabase/Postgres
        ├── sources
        ├── crawls
        ├── pages
        ├── technologies
        ├── categories
        ├── products
        ├── ingredients
        └── product_ingredients
```

## Phase 1.1 scope

1. `detect` — inspect a URL and report likely technologies.
2. `crawl` — discover and persist pages/products/categories.
3. `db:init` — create the Supabase schema from the migration.
4. `export` — later: export canonical JSON for downstream AI/RAG systems.

The first production adapter will be Darukade. Do not hard-code Darukade selectors into the crawler core; put them in `src/adapters/darukade.ts` once the actual site structure has been inspected.

## Setup

```bash
npm install
cp .env.example .env
npm run build
```

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ACCESS_TOKEN` (create a personal access token at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)).

Then:

```bash
siteharvest db:init
siteharvest detect https://example.com
siteharvest crawl https://example.com --max-pages 100
```

### Database connection

Migrations run through the **Supabase Management API** using your personal access token — no raw Postgres connection string needed. The project reference is extracted automatically from `SUPABASE_URL`. Keep the service-role key and access token server-side only.

## Important data policy

Public accessibility does not automatically mean permission to republish a site's complete catalog. Before running a large crawl, check the target site's terms, robots directives, rate limits, and data/licensing policy. SiteHarvest is a technical ingestion framework, not a license to copy third-party databases.
