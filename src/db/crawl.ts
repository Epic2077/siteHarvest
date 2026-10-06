import { supabaseClient } from "./client.js";

export type CrawlStatus = "running" | "completed" | "failed" | "cancelled";

export type CrawlRecord = {
  id: string;
  source_id: string;
  status: CrawlStatus;
  pages_seen: number;
  products_found: number;
  errors: number;
  metadata: Record<string, unknown>;
  source: { base_url: string } | null;
};

export async function createCrawl(
  sourceId: string,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  const supabase = supabaseClient();
  const { data, error } = await supabase
    .from("crawls")
    .insert({ source_id: sourceId, metadata })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create crawl: ${error.message}`);
  return data.id as string;
}

export async function getCrawl(crawlId: string): Promise<CrawlRecord> {
  const supabase = supabaseClient();
  const { data, error } = await supabase
    .from("crawls")
    .select(
      "id, source_id, status, pages_seen, products_found, errors, metadata, source:sources(base_url)",
    )
    .eq("id", crawlId)
    .single();
  if (error)
    throw new Error(`Failed to load crawl ${crawlId}: ${error.message}`);
  const row = data as unknown as Omit<CrawlRecord, "source"> & {
    source: { base_url: string } | { base_url: string }[] | null;
  };
  return { ...row, source: Array.isArray(row.source) ? (row.source[0] ?? null) : row.source };
}

export async function finishCrawl(
  crawlId: string,
  status: Exclude<CrawlStatus, "running">,
): Promise<void> {
  const supabase = supabaseClient();
  const { error } = await supabase
    .from("crawls")
    .update({ status, finished_at: new Date().toISOString() })
    .eq("id", crawlId);
  if (error) throw new Error(`Failed to finish crawl: ${error.message}`);
}
