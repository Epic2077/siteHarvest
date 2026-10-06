export type FetchResult = {
  url: string;
  status: number;
  contentType: string;
  html: string;
  headers: Record<string, string>;
};

export class Fetcher {
  constructor(
    private readonly userAgent = process.env.CRAWLER_USER_AGENT ?? 'SiteHarvestBot/0.1',
    private readonly delayMs = Number(process.env.CRAWLER_DELAY_MS ?? 250),
    private readonly timeoutMs = Number(process.env.CRAWLER_TIMEOUT_MS ?? 30000),
    private readonly retries = Number(process.env.CRAWLER_RETRIES ?? 2),
  ) {}

  async get(url: string): Promise<FetchResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      try {
        const response = await fetch(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            'user-agent': this.userAgent,
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          },
        });
        if ((response.status === 429 || response.status >= 500) && attempt < this.retries) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * 2 ** attempt));
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => { headers[key] = value; });
        return {
          url: response.url,
          status: response.status,
          contentType: response.headers.get('content-type') ?? '',
          html: await response.text(),
          headers,
        };
      } catch (error) {
        lastError = error;
        if (attempt < this.retries) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
  }
}
