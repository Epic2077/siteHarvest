import { crawlDurable, type CrawlProgress } from "../core/crawler.js";
import {
  createCrawl,
  finishCrawl,
  getCrawl,
} from "../db/crawl.js";
import { enqueueUrls } from "../db/queue.js";
import { createSource } from "../db/persist.js";
import { discoverSitemapUrls } from "../core/sitemap.js";
import { isCrawlableUrl, normalizeUrl } from "../core/url.js";
import { selectAdapter } from "../adapters/registry.js";

export async function crawlCommand(
  url: string,
  maxPages: number,
  resumeId?: string,
  concurrency?: number,
  batchSize?: number,
  storeRawHtml = false,
  productOnly = false,
) {
  let crawlId = resumeId;
  let sourceId: string;
  let effectiveProductOnly = productOnly;

  if (crawlId) {
    const existing = await getCrawl(crawlId);
    if (!existing.source?.base_url)
      throw new Error(`Crawl ${crawlId} has no source URL.`);
    url = existing.source.base_url;
    sourceId = existing.source_id;
    // Restore product-only scope from persisted metadata so resume matches the original run.
    effectiveProductOnly = !!(existing.metadata as Record<string, unknown>)?.productOnly;
    console.log(`\n⏯ Resuming crawl ${crawlId} for ${url}`);
    if (effectiveProductOnly) console.log(`  ↳ product-only scope restored`);
  } else {
    sourceId = await createSource(new URL(url).origin, []);
    crawlId = await createCrawl(sourceId, { maxPages, sameOriginOnly: true, productOnly: effectiveProductOnly });
    console.log(`\n⏳ Starting crawl ${crawlId} for ${new URL(url).origin}`);
    if (effectiveProductOnly) console.log(`  ↳ product-only mode: filtering to product-detail and catalog pages`);
  }

  const origin = new URL(url).origin;
  const sitemapUrls = await discoverSitemapUrls(origin);
  const startNormalized = normalizeUrl(url, url);
  const seeds = [url, ...sitemapUrls].flatMap((candidate) => {
    try {
      const normalized = normalizeUrl(candidate, url);
      if (!isCrawlableUrl(normalized, origin)) return [];
      // In product-only mode, filter sitemap seeds through the adapter classifier.
      // The start URL is always kept (user's explicit input).
      if (effectiveProductOnly && normalized !== startNormalized) {
        const adapter = selectAdapter(normalized, []);
        const classification = adapter.classifyUrl?.(normalized) ?? 'product';
        if (classification === 'reject') return [];
      }
      return [normalized];
    } catch {
      return [];
    }
  });
  await enqueueUrls(crawlId, [...new Set(seeds)]);
  console.log(`→ Seeded ${new Set(seeds).size} URL(s)`);

  try {
    const stats = await crawlDurable(url, {
      maxPages,
      sameOriginOnly: true,
      crawlId,
      productOnly: effectiveProductOnly,
      sourceId,
      concurrency,
      batchSize,
      storeRawHtml,
      onProgress: async (progress: CrawlProgress) => {
        const total = progress.total ?? "?";
        process.stdout.write(
          `\r   [${progress.current}/${total}] ${progress.type} ${progress.url}`,
        );
        process.stdout.write("\x1b[K");
      },
    });

    await finishCrawl(crawlId, "completed");
    process.stdout.write("\r" + " ".repeat(100) + "\r");
    console.log(
      `✓ Crawl complete. ${stats.pagesSeen} pages processed, ${stats.productsFound} products found, ${stats.errors} errors.`,
    );
    console.log(
      `  Resume this run later with: siteharvest crawl ${url} --resume ${crawlId}`,
    );
  } catch (error) {
    await finishCrawl(crawlId, "failed").catch(() => undefined);
    throw error;
  }
}
