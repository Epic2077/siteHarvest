import { supabaseClient } from './client.js';
import type { ExtractedPage } from '../types/domain.js';
import { normalizeUrl } from '../core/url.js';

export type QueueUrl = {
  id: string;
  crawl_id: string;
  url: string;
  normalized_url: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  attempts: number;
  max_attempts: number;
  status_code: number | null;
  error: string | null;
};

export type UrlCounts = {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  skipped: number;
  total: number;
};

export type CrawlBatchResult =
  | { queueId: string; status: 'completed'; statusCode: number; page: ExtractedPage & { contentHash: string }; discoveredUrls: string[] }
  | { queueId: string; status: 'skipped'; statusCode?: number; error?: string }
  | { queueId: string; status: 'failed'; statusCode?: number; error: string };

export type QueueState = {
  retryable: number;
  processing: number;
  nextAttemptAt: string | null;
};

export async function enqueueUrls(crawlId: string, urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const supabase = supabaseClient();

  // Batch insert in chunks to avoid oversized payloads
  const CHUNK = 500;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const chunk = urls.slice(i, i + CHUNK).map((url) => {
      const normalized = normalizeUrl(url);
      return {
        crawl_id: crawlId,
        url,
        normalized_url: normalized,
        status: 'pending',
      };
    });

    const { error } = await supabase.from('crawl_urls').upsert(chunk, {
      onConflict: 'crawl_id,normalized_url',
      ignoreDuplicates: true,
    });
    if (error) throw new Error(`Failed to enqueue URLs: ${error.message}`);
  }
}

export async function claimUrls(crawlId: string, limit: number, leaseSeconds = 300): Promise<QueueUrl[]> {
  const supabase = supabaseClient();
  const { data, error } = await supabase.rpc('claim_crawl_urls', {
    p_crawl_id: crawlId,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`Failed to claim URLs: ${error.message}`);
  return (data ?? []) as QueueUrl[];
}

export async function persistCrawlBatch(crawlId: string, sourceId: string, results: CrawlBatchResult[]): Promise<void> {
  if (results.length === 0) return;
  const supabase = supabaseClient();
  const { error } = await supabase.rpc('persist_crawl_batch', {
    p_crawl_id: crawlId,
    p_source_id: sourceId,
    p_results: results,
  });
  if (error) throw new Error(`Failed to persist crawl batch: ${error.message}`);
}

export async function getQueueState(crawlId: string): Promise<QueueState> {
  const supabase = supabaseClient();
  const { data, error } = await supabase.rpc('crawl_queue_state', { p_crawl_id: crawlId });
  if (error) throw new Error(`Failed to inspect crawl queue: ${error.message}`);
  const row = (data as { retryable: number | string; processing: number | string; next_attempt_at: string | null }[] | null)?.[0];
  return {
    retryable: Number(row?.retryable ?? 0),
    processing: Number(row?.processing ?? 0),
    nextAttemptAt: row?.next_attempt_at ?? null,
  };
}

export async function releaseStaleLocks(crawlId: string): Promise<number> {
  const supabase = supabaseClient();
  const { data, error } = await supabase.rpc('release_stale_locks', {
    p_crawl_id: crawlId,
  });
  if (error) throw new Error(`Failed to release stale locks: ${error.message}`);
  return (data as number) ?? 0;
}

export async function getUrlCounts(crawlId: string): Promise<UrlCounts> {
  const supabase = supabaseClient();
  const { data, error } = await supabase.rpc('crawl_url_counts', { p_crawl_id: crawlId });
  if (error) throw new Error(`Failed to get URL counts: ${error.message}`);

  const counts: UrlCounts = { pending: 0, processing: 0, completed: 0, failed: 0, skipped: 0, total: 0 };
  for (const row of (data as { status: string; count: number }[]) ?? []) {
    const key = row.status as keyof UrlCounts;
    if (key in counts && key !== 'total') {
      counts[key] = Number(row.count);
    }
  }
  counts.total = counts.pending + counts.processing + counts.completed + counts.failed + counts.skipped;
  return counts;
}
