import { Command } from "commander";
import { supabaseClient } from "../db/client.js";
import { extractGeneric } from "../extractors/generic.js";
import { selectAdapter } from "../adapters/registry.js";
import { detectTechnologies } from "../detectors/tech.js";
import { sha256 } from "../utils/hash.js";
import { normalizeUrl, isCrawlableUrl } from "../core/url.js";
import { Fetcher } from "../core/fetcher.js";
import { RobotsPolicy } from "../core/robots.js";
import { persistCrawlBatch } from "../db/queue.js";
import type { ExtractedPage, ProductRecord, IngredientRecord, CategoryRecord } from "../types/domain.js";

export async function fixCommand(
  crawlId: string,
  options: { maxPages?: number; refetch?: boolean; batchSize?: number }
) {
  const supabase = supabaseClient();
  
  console.log(`🔧 Fixing crawl ${crawlId}...`);

  const { data: crawl, error: crawlErr } = await supabase
    .from('crawls')
    .select('*, source:sources(*)')
    .eq('id', crawlId)
    .single();

  if (crawlErr || !crawl) {
    throw new Error(`Crawl ${crawlId} not found: ${crawlErr?.message}`);
  }

  const sourceId = crawl.source_id;
  const origin = crawl.source?.base_url ? new URL(crawl.source.base_url).origin : null;

  if (!origin) {
    throw new Error('Crawl has no source origin');
  }

  console.log(`Origin: ${origin}`);
  console.log(`Source ID: ${sourceId}`);

  const batchSize = options.batchSize ?? 100;
  let totalPagesFetched = 0;
  let allPages: Array<{ id: string; url: string; canonical_url: string | null; partitions: unknown; content_text: string | null; raw_html: string | null; source_id: string }> = [];

  // Fetch pages in batches to avoid timeout
  while (totalPagesFetched < (options.maxPages ?? 500)) {
    const remaining = Math.min(batchSize, (options.maxPages ?? 500) - totalPagesFetched);
    
    const { data: pages, error: pagesErr } = await supabase
      .from('pages')
      .select('id, url, canonical_url, partitions, content_text, raw_html, source_id')
      .eq('source_id', sourceId)
      .order('created_at', { ascending: false })
      .range(totalPagesFetched, totalPagesFetched + remaining - 1);

    if (pagesErr) throw new Error(`Failed to fetch pages: ${pagesErr.message}`);
    if (!pages || pages.length === 0) break;

    allPages.push(...pages);
    totalPagesFetched += pages.length;
    
    if (pages.length < remaining) break;
  }

  console.log(`Found ${allPages.length} pages to check`);

  const robots = new RobotsPolicy();
  await robots.load(origin);

  const fetcher = new Fetcher();
  let productsFound = 0;
  let pagesUpdated = 0;
  let errors = 0;

  for (const page of allPages) {
    try {
      if (!page.url) continue;
      
      // Check if product already exists for this page
      const { data: existingProduct } = await supabase
        .from('products')
        .select('id')
        .eq('source_page_id', page.id)
        .limit(1);

      if (existingProduct && existingProduct.length > 0) {
        continue; // Already has product
      }

      // Check if URL looks like a product detail page
      const looksLikeProduct = /\/(products?|item|p|prd)[\/_-]/i.test(new URL(page.url).pathname);
      const isCategoryPage = /\/(category|categories|brand|brands|tag|tags|page|search|filter|sort|compare|wishlist|cart|checkout|login|register|account)/i.test(new URL(page.url).pathname);
      
      if (!looksLikeProduct || isCategoryPage) {
        continue; // Skip listing/category pages
      }

      let html: string | undefined;
      if (page.raw_html) {
        html = page.raw_html;
      } else if (options.refetch) {
        console.log(`  ↳ Refetching ${page.url}`);
        const fetched = await fetcher.get(page.url);
        if (!fetched.contentType.includes('text/html')) continue;
        html = fetched.html;
      } else {
        // Try to reconstruct from partitions
        continue; // Skip if no raw HTML and not refetching
      }

      if (!html) continue;

      const technologies = detectTechnologies(html, {});
      const extracted = extractGeneric(page.url, html, technologies);
      
      if (!extracted.product) {
        continue; // No product detected
      }

      // Refine with adapter
      const adapter = selectAdapter(extracted.url, extracted.technologies);
      if (adapter.refineProduct) {
        extracted.product = await adapter.refineProduct(extracted.product, extracted);
      }

      // Persist the product
      const contentHash = sha256(extracted.textContent ?? html);
      const partitions = extracted.partitions ?? [];
      
      // Update page with partitions and content_hash
      const { error: updateErr } = await supabase
        .from('pages')
        .update({
          partitions,
          content_hash: contentHash,
          content_text: extracted.textContent,
          updated_at: new Date().toISOString(),
        })
        .eq('id', page.id);

      if (updateErr) {
        console.error(`Failed to update page ${page.id}:`, updateErr.message);
        errors++;
        continue;
      }

      // Persist product batch
      const results = [{
        queueId: page.id, // Use page ID as queue ID for tracking
        status: 'completed' as const,
        statusCode: 200,
        page: {
          ...extracted,
          rawHtml: undefined,
          contentHash,
        },
        discoveredUrls: [],
      }];

      await persistCrawlBatch(crawlId, sourceId, results);
      productsFound++;
      pagesUpdated++;

      if (productsFound % 10 === 0) {
        console.log(`  Progress: ${productsFound} products extracted...`);
      }

    } catch (error) {
      errors++;
      console.error(`Error processing ${page.url}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`\n✓ Fix complete. ${productsFound} products extracted, ${pagesUpdated} pages updated, ${errors} errors.`);
}

export function fixCommandCli(program: Command) {
  program
    .command('fix <crawl-id>')
    .description('Re-process crawled pages to extract missing products/ingredients/categories. Use --refetch to re-fetch pages that lack stored raw HTML.')
    .option('--max-pages <number>', 'Maximum pages to process', '500')
    .option('--batch-size <number>', 'Pages to fetch per batch (avoids timeout)', '100')
    .option('--refetch', 'Re-fetch pages that lack raw HTML', false)
    .action(async (crawlId, options) => {
      await fixCommand(crawlId, {
        maxPages: Number(options.maxPages),
        batchSize: Number(options.batchSize),
        refetch: options.refetch,
      });
    });
}