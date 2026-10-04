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
  ) {}

  async get(url: string): Promise<FetchResult> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': this.userAgent,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      },
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    return {
      url: response.url,
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      html: await response.text(),
      headers,
    };
  }
}
