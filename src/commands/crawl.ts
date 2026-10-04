import { crawl, discoverUrls, type CrawlProgress } from '../core/crawler.js';
import { createSource, persistPage } from '../db/persist.js';
import type { ExtractedPage } from '../types/domain.js';

const FLUSH_BATCH_SIZE = Number(process.env.CRAWLER_FLUSH_BATCH ?? 20);

async function flushBatch(sourceId: string, pages: ExtractedPage[]): Promise<number> {
  let persisted = 0;
  for (const page of pages) {
    try {
      await persistPage(sourceId, page);
      persisted++;
    } catch (error) {
      console.error(`\n✗ Failed to persist ${page.url}:`, error instanceof Error ? error.message : error);
    }
  }
  return persisted;
}

export async function crawlCommand(url: string, maxPages: number) {
  const options = { maxPages, sameOriginOnly: true };

  // ── Phase 1: Discover all reachable URLs ──────────────────────────────
  console.log(`\n⏳ Phase 1/2 — Discovering URLs on ${new URL(url).origin} ...`);
  const knownUrls = await discoverUrls(url, options, (found) => {
    process.stdout.write(`\r   Found ${found} pages so far...`);
  });
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  console.log(`✓ Discovered ${knownUrls.length} reachable pages.\n`);

  if (knownUrls.length === 0) {
    console.log('No pages found. Exiting.');
    return;
  }

  // ── Phase 2: Crawl & extract (progress only, no DB writes yet) ───────
  console.log(`⏳ Phase 2/2 — Crawling up to ${maxPages} pages ...\n`);

  const results = await crawl(url, options, knownUrls, async (progress: CrawlProgress) => {
    const total = progress.total ?? '?';
    const pct = progress.total ? ` (${Math.round((progress.current / progress.total) * 100)}%)` : '';
    process.stdout.write(`\r   [${progress.current}/${total}]${pct} ${progress.type} ${progress.url}`);
    process.stdout.write('\x1b[K'); // clear to end of line
  });

  process.stdout.write('\r' + ' '.repeat(80) + '\r');
  console.log(`✓ Extracted ${results.length} pages.\n`);

  if (results.length === 0) {
    console.log('No pages extracted. Exiting.');
    return;
  }

  // ── Persist in batches ───────────────────────────────────────────────
  console.log(`⏳ Persisting ${results.length} pages to Supabase (batch size: ${FLUSH_BATCH_SIZE}) ...\n`);

  const sourceId = await createSource(new URL(url).origin, results[0].technologies);
  let persistedCount = 0;

  for (let i = 0; i < results.length; i += FLUSH_BATCH_SIZE) {
    const batch = results.slice(i, i + FLUSH_BATCH_SIZE);
    const batchEnd = Math.min(i + FLUSH_BATCH_SIZE, results.length);
    process.stdout.write(`\r   Flushing ${i + 1}–${batchEnd} of ${results.length} ...`);
    persistedCount += await flushBatch(sourceId, batch);
  }

  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  console.log(`✓ Persisted ${persistedCount} pages to Supabase.`);
  console.log(`\n🎉 Crawl complete. ${persistedCount}/${results.length} pages saved.`);
}
