# SiteHarvest

Discover, normalize, and persist website catalog data for developers and AI systems.

SiteHarvest crawls websites, extracts structured product data (including ingredients, categories, and breadcrumbs), and stores everything in a normalized PostgreSQL schema on Supabase.

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Supabase credentials

# Initialize database schema
npm run dev -- db:init

# Crawl a website
npm run dev -- crawl https://example.com --max-pages 100 --store-raw-html

# Export products as JSON
npm run dev -- export products.json --limit 500
```

## Commands

| Command | Description |
|---------|-------------|
| `detect <url>` | Detect technologies used by a website (framework, CMS, ecommerce, analytics, etc.) |
| `db:init` | Create/update the SiteHarvest schema in Supabase (runs migrations) |
| `inspect <url>` | Inspect a URL: show detected technology, adapter, and extracted data without writing to DB |
| `crawl [options] <url>` | Crawl a same-origin website and persist pages/products |
| `export [options] <output>` | Export normalized products as JSON for downstream apps/AI |
| `fix [options] <crawl-id>` | Re-process crawled pages to extract missing products/ingredients/categories |
| `dedupe-categories [options] <source-id>` | Deduplicate exact duplicate categories, preserving links |
| `fix-categories <source-id>` | One-time fix: merge duplicate categories by name, add unique constraint |

### Crawl Options

```bash
siteharvest crawl https://example.com \
  --max-pages 1000 \
  --concurrency 5 \
  --batch-size 20 \
  --store-raw-html \
  --product-only
```

- `--max-pages`: Maximum pages to crawl (default: 100)
- `--resume <crawl-id>`: Resume an existing crawl
- `--concurrency`: Simultaneous fetches (default: 3)
- `--batch-size`: Queue claim batch size (default: 20)
- `--store-raw-html`: Store raw HTML for later re-processing (recommended)
- `--product-only`: Only crawl product-detail and catalog pages

### Fix Options

```bash
siteharvest fix <crawl-id> \
  --max-pages 500 \
  --batch-size 100 \
  --refetch
```

- `--refetch`: Re-fetch pages that lack stored raw HTML (slow but thorough)
- `--batch-size`: Pages per batch to avoid timeouts (default: 100)

### Dedupe Categories Options

```bash
# Exact duplicates only (same name + same source_url)
siteharvest dedupe-categories <source-id> --dry-run

# Also merge by name only (collapses breadcrumb hierarchy - use carefully)
siteharvest dedupe-categories <source-id> --by-name-only --dry-run
```

## Data Model

```
sources
  └── crawls
        └── crawl_urls (queue with leasing)
              └── pages
                    ├── products
                    │     ├── product_categories (M:N)
                    │     │     └── categories (breadcrumb hierarchy)
                    │     └── product_ingredients (M:N)
                    │           └── ingredients
```

Key features:
- **Durable queue**: Atomic claim with `FOR UPDATE SKIP LOCKED`, lease-based processing, retry with exponential backoff
- **Transactional batch writes**: `persist_crawl_batch` RPC persists pages, products, categories, ingredients in one transaction
- **Normalized categories**: Breadcrumb hierarchy stored once per unique name, shared across products
- **Partitioned content**: Pages stored with metadata, JSON-LD, tables, lists, and semantic sections

## Environment Variables

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ACCESS_TOKEN=your-personal-access-token  # For db:init via Management API

# Optional crawler tuning
CRAWLER_CONCURRENCY=3
CRAWLER_FLUSH_BATCH=20
```

## Extending with Adapters

Add site-specific extraction logic in `src/adapters/`:

```typescript
// src/adapters/mysite.ts
export const mysiteAdapter: SiteAdapter = {
  name: 'mysite',
  matches: (url) => url.includes('mysite.com'),
  discoverUrls: (page) => page.links,
  classifyUrl: (url) => 'product' | 'discovery' | 'reject',
  refineProduct: async (product, page) => {
    // Enhance product with site-specific data
    return enhancedProduct;
  },
};
```

Register in `src/adapters/registry.ts`.

## Export Format

```json
{
  "products": [
    {
      "id": "uuid",
      "canonical_url": "https://...",
      "name": "Product Name",
      "brand": "Brand",
      "description": "...",
      "price": 29.99,
      "currency": "USD",
      "availability": "InStock",
      "images": ["https://..."],
      "categories": ["Category", "Subcategory"],
      "ingredients": [
        { "name": "Ingredient", "amount": 10, "unit": "mg" }
      ],
      "attributes": { "custom": "data" }
    }
  ]
}
```

## License

MIT