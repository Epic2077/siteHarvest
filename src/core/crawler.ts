import pLimit from "p-limit";
import { Fetcher } from "./fetcher.js";
import { detectTechnologies } from "../detectors/tech.js";
import { extractGeneric } from "../extractors/generic.js";
import { selectAdapter } from "../adapters/registry.js";
import { RobotsPolicy } from "./robots.js";
import type { ExtractedPage } from "../types/domain.js";
import type { UrlClassification } from "../adapters/types.js";
import {
  getQueueState,
  getUrlCounts,
  persistCrawlBatch,
  releaseStaleLocks,
  claimUrls,
  type CrawlBatchResult,
  type QueueUrl,
} from "../db/queue.js";
import { normalizeUrl, isCrawlableUrl } from "./url.js";
import { sha256 } from "../utils/hash.js";

export type CrawlOptions = {
  maxPages: number;
  sameOriginOnly: boolean;
  productOnly?: boolean;
};

export type CrawlProgress = {
  current: number;
  total: number | undefined;
  url: string;
  type: "PRODUCT" | "PAGE";
};

export type DurableCrawlStats = {
  pagesSeen: number;
  productsFound: number;
  errors: number;
};

export type DurableCrawlOptions = CrawlOptions & {
  crawlId: string;
  sourceId: string;
  concurrency?: number;
  batchSize?: number;
  storeRawHtml?: boolean;
  onProgress?: (progress: CrawlProgress) => Promise<void>;
};

/**
 * Crawl backed by leased database queue items and one transactional write per batch.
 */
export async function crawlDurable(
  startUrl: string,
  options: DurableCrawlOptions,
): Promise<DurableCrawlStats> {
  const origin = new URL(startUrl).origin;
  const fetcher = new Fetcher();
  const robots = new RobotsPolicy();
  await robots.load(origin);

  const concurrency = Math.max(1, options.concurrency ?? Number(process.env.CRAWLER_CONCURRENCY ?? 3));
  const batchSize = Math.max(concurrency, options.batchSize ?? Number(process.env.CRAWLER_FLUSH_BATCH ?? 20));
  const limit = pLimit(concurrency);
  const initialCounts = await getUrlCounts(options.crawlId);
  let pagesSeen = initialCounts.completed;
  let productsFound = 0;
  let errors = 0;

  await releaseStaleLocks(options.crawlId);

  while (pagesSeen < options.maxPages) {
    const remaining = options.maxPages - pagesSeen;
    const claimed = await claimUrls(
      options.crawlId,
      Math.min(batchSize, remaining),
    );
    if (claimed.length === 0) {
      const state = await getQueueState(options.crawlId);
      if (state.processing > 0) {
        await releaseStaleLocks(options.crawlId);
        await sleep(500);
        continue;
      }
      if (state.retryable > 0 && state.nextAttemptAt) {
        await sleep(Math.max(100, Math.min(new Date(state.nextAttemptAt).getTime() - Date.now(), 5_000)));
        continue;
      }
      break;
    }

    const results = await Promise.all(
      claimed.map((item) =>
        limit(() => processQueuedUrl(item, origin, options, fetcher, robots)),
      ),
    );
    await persistCrawlBatch(options.crawlId, options.sourceId, results);

    for (const result of results) {
      if (result.status === "completed") {
        pagesSeen++;
        if (result.page.product) productsFound++;
        await options.onProgress?.({
          current: pagesSeen,
          total: undefined,
          url: result.page.url,
          type: result.page.product ? "PRODUCT" : "PAGE",
        });
      } else if (result.status === "failed") {
        errors++;
      }
    }
  }

  return { pagesSeen, productsFound, errors };
}

async function processQueuedUrl(
  item: QueueUrl,
  origin: string,
  options: DurableCrawlOptions,
  fetcher: Fetcher,
  robots: RobotsPolicy,
): Promise<CrawlBatchResult> {
  try {
    if (!robots.isAllowed(item.url)) {
      return { queueId: item.id, status: "skipped", error: "Blocked by robots.txt" };
    }

    // In product-only mode, skip URLs the adapter classifies as irrelevant.
    if (options.productOnly) {
      const adapter = selectAdapter(item.url, []);
      const classification = adapter.classifyUrl?.(item.url) ?? 'product';
      if (classification === 'reject') {
        return { queueId: item.id, status: "skipped", error: "Rejected by product-only scope" };
      }
    }

    const fetched = await fetcher.get(item.url);
    if (
      !fetched.contentType.includes("text/html") &&
      !fetched.contentType.includes("application/xhtml")
    ) {
      return { queueId: item.id, status: "skipped", statusCode: fetched.status, error: `Unsupported content type: ${fetched.contentType}` };
    }

    const technologies = detectTechnologies(fetched.html, fetched.headers);
    const page = extractGeneric(fetched.url, fetched.html, technologies);
    const canonical = page.canonicalUrl ? normalizeUrl(page.canonicalUrl, page.url) : undefined;
    page.canonicalUrl = canonical && isCrawlableUrl(canonical, origin) ? canonical : undefined;

const adapter = selectAdapter(page.url, page.technologies);

    // In product-only mode, skip product extraction on discovery pages.
    const pageClassification: UrlClassification = options.productOnly
      ? (adapter.classifyUrl?.(page.url) ?? 'product')
      : 'product';

    console.debug(`[crawler] pageClassification=${pageClassification} page.product=${page.product ? 'exists' : 'undefined'}`);
    if (page.product && adapter.refineProduct) {
      page.product = await adapter.refineProduct(page.product, page);
    }
    const nextUrls = new Set<string>();
    for (const next of adapter.discoverUrls(page)) {
      try {
        const normalized = normalizeUrl(next, page.url);
        if (
          robots.isAllowed(normalized) &&
          (!options.sameOriginOnly || new URL(normalized).origin === origin) &&
          isCrawlableUrl(normalized, origin)
        ) {
          // In product-only mode, filter discovered links through the adapter classifier.
          if (options.productOnly) {
            const nextAdapter = selectAdapter(normalized, []);
            const nextClass = nextAdapter.classifyUrl?.(normalized) ?? 'product';
            if (nextClass === 'reject') continue;
          }
          nextUrls.add(normalized);
        }
      } catch {
        /* ignore invalid links */
      }
    }
    const persistedPage = {
      ...page,
      // In product-only mode, clear product data from discovery pages
      // so we don't persist phantom products from listing pages.
      product: pageClassification === 'discovery' ? undefined : page.product,
      rawHtml: options.storeRawHtml ? page.rawHtml : undefined,
      contentHash: sha256(page.textContent ?? fetched.html),
    };
    return {
      queueId: item.id,
      status: "completed",
      statusCode: fetched.status,
      page: persistedPage,
      discoveredUrls: [...nextUrls],
    };
  } catch (error) {
    return {
      queueId: item.id,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Lightweight BFS discovery pass — fetches pages and extracts links only.
 * Returns all reachable same-origin URLs so the real crawl can show [n/total] progress.
 */
export async function discoverUrls(
  startUrl: string,
  options: CrawlOptions,
  onProgress?: (found: number) => void,
): Promise<string[]> {
  const origin = new URL(startUrl).origin;
  const fetcher = new Fetcher();
  const robots = new RobotsPolicy();
  await robots.load(origin);

  const queue: string[] = [startUrl];
  const seen = new Set<string>();
  const concurrency = Number(process.env.CRAWLER_CONCURRENCY ?? 3);
  const limit = pLimit(concurrency);
  const htmlUrls: string[] = [];

  while (queue.length) {
    const batch: Promise<string[] | undefined>[] = [];
    while (queue.length && batch.length < concurrency) {
      const url = queue.shift()!;
      if (seen.has(url) || !robots.isAllowed(url)) continue;
      seen.add(url);
      batch.push(
        limit(async () => {
          try {
            const fetched = await fetcher.get(url);
            if (
              !fetched.contentType.includes("text/html") &&
              !fetched.contentType.includes("application/xhtml")
            )
              return undefined;
            htmlUrls.push(fetched.url);
            // lightweight link extraction — no full parsing
            const linkMatches = fetched.html.matchAll(
              /href=["']([^"']+)["']/gi,
            );
            const links: string[] = [];
            for (const m of linkMatches) {
              try {
                const resolved = new URL(m[1], fetched.url)
                  .toString()
                  .split("#")[0];
                if (
                  robots.isAllowed(resolved) &&
                  (!options.sameOriginOnly ||
                    new URL(resolved).origin === origin) &&
                  !seen.has(resolved)
                ) {
                  links.push(resolved);
                }
              } catch {
                /* skip invalid */
              }
            }
            return links;
          } catch {
            return undefined;
          }
        }),
      );
    }

    const results = await Promise.all(batch);
    for (const links of results) {
      if (!links) continue;
      for (const link of links) {
        if (!seen.has(link) && !queue.includes(link)) queue.push(link);
      }
    }
    onProgress?.(htmlUrls.length);
  }

  return htmlUrls;
}

export async function crawl(
  startUrl: string,
  options: CrawlOptions,
  knownUrls?: string[],
  onProgress?: (progress: CrawlProgress) => Promise<void>,
): Promise<ExtractedPage[]> {
  const origin = new URL(startUrl).origin;
  const fetcher = new Fetcher();
  const robots = new RobotsPolicy();
  await robots.load(origin);

  const queue = [startUrl];
  const seen = new Set<string>();
  const results: ExtractedPage[] = [];
  const limit = pLimit(Number(process.env.CRAWLER_CONCURRENCY ?? 3));

  // If we have a known URL set from discovery, pre-populate `seen`
  // so progress total is accurate and we don't re-discover URLs we already know about.
  const totalEstimated = knownUrls?.length;

  while (queue.length && results.length < options.maxPages) {
    const batch: Promise<ExtractedPage | undefined>[] = [];
    while (
      queue.length &&
      batch.length < Number(process.env.CRAWLER_CONCURRENCY ?? 3) &&
      results.length + batch.length < options.maxPages
    ) {
      const url = queue.shift()!;
      if (seen.has(url) || !robots.isAllowed(url)) continue;
      seen.add(url);
      batch.push(
        limit(async () => {
          try {
            const fetched = await fetcher.get(url);
            if (
              !fetched.contentType.includes("text/html") &&
              !fetched.contentType.includes("application/xhtml")
            )
              return undefined;
            const technologies = detectTechnologies(
              fetched.html,
              fetched.headers,
            );
            return extractGeneric(fetched.url, fetched.html, technologies);
          } catch (error) {
            console.error(
              `Failed: ${url}`,
              error instanceof Error ? error.message : error,
            );
            return undefined;
          }
        }),
      );
    }

    const pages = (await Promise.all(batch)).filter(Boolean) as ExtractedPage[];
    for (const page of pages) {
      const adapter = selectAdapter(page.url, page.technologies);
      if (page.product && adapter.refineProduct) {
        page.product = await adapter.refineProduct(page.product, page);
      }
      results.push(page);
      await onProgress?.({
        current: results.length,
        total: totalEstimated,
        url: page.url,
        type: page.product ? "PRODUCT" : "PAGE",
      });
      for (const next of adapter.discoverUrls(page)) {
        try {
          const normalized = new URL(next).toString().split("#")[0];
          if (
            robots.isAllowed(normalized) &&
            (!options.sameOriginOnly ||
              new URL(normalized).origin === origin) &&
            !seen.has(normalized) &&
            !queue.includes(normalized)
          )
            queue.push(normalized);
        } catch {
          /* ignore invalid links */
        }
      }
    }
  }

  return results;
}
