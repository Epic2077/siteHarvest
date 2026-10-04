import pLimit from 'p-limit';
import { Fetcher } from './fetcher.js';
import { detectTechnologies } from '../detectors/tech.js';
import { extractGeneric } from '../extractors/generic.js';
import { selectAdapter } from '../adapters/registry.js';
import { RobotsPolicy } from './robots.js';
import type { ExtractedPage } from '../types/domain.js';

export type CrawlOptions = {
  maxPages: number;
  sameOriginOnly: boolean;
};

export type CrawlProgress = {
  current: number;
  total: number | undefined;
  url: string;
  type: 'PRODUCT' | 'PAGE';
};

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
      batch.push(limit(async () => {
        try {
          const fetched = await fetcher.get(url);
          if (!fetched.contentType.includes('text/html') && !fetched.contentType.includes('application/xhtml')) return undefined;
          htmlUrls.push(fetched.url);
          // lightweight link extraction — no full parsing
          const linkMatches = fetched.html.matchAll(/href=["']([^"']+)["']/gi);
          const links: string[] = [];
          for (const m of linkMatches) {
            try {
              const resolved = new URL(m[1], fetched.url).toString().split('#')[0];
              if (
                robots.isAllowed(resolved) &&
                (!options.sameOriginOnly || new URL(resolved).origin === origin) &&
                !seen.has(resolved)
              ) {
                links.push(resolved);
              }
            } catch { /* skip invalid */ }
          }
          return links;
        } catch {
          return undefined;
        }
      }));
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
    while (queue.length && batch.length < Number(process.env.CRAWLER_CONCURRENCY ?? 3) && results.length + batch.length < options.maxPages) {
      const url = queue.shift()!;
      if (seen.has(url) || !robots.isAllowed(url)) continue;
      seen.add(url);
      batch.push(limit(async () => {
        try {
          const fetched = await fetcher.get(url);
          if (!fetched.contentType.includes('text/html') && !fetched.contentType.includes('application/xhtml')) return undefined;
          const technologies = detectTechnologies(fetched.html, fetched.headers);
          return extractGeneric(fetched.url, fetched.html, technologies);
        } catch (error) {
          console.error(`Failed: ${url}`, error instanceof Error ? error.message : error);
          return undefined;
        }
      }));
    }

    const pages = (await Promise.all(batch)).filter(Boolean) as ExtractedPage[];
    for (const page of pages) {
      results.push(page);
      await onProgress?.({
        current: results.length,
        total: totalEstimated,
        url: page.url,
        type: page.product ? 'PRODUCT' : 'PAGE',
      });
      const adapter = selectAdapter(page.url, page.technologies);
      for (const next of adapter.discoverUrls(page)) {
        try {
          const normalized = new URL(next).toString().split('#')[0];
          if (robots.isAllowed(normalized) && (!options.sameOriginOnly || new URL(normalized).origin === origin) && !seen.has(normalized) && !queue.includes(normalized)) queue.push(normalized);
        } catch { /* ignore invalid links */ }
      }
    }
  }

  return results;
}
