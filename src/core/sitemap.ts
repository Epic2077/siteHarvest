/**
 * Sitemap discovery — fetches robots.txt Sitemap directives and XML sitemaps
 * to seed the crawl queue without doing a full BFS pre-scan.
 */

export async function discoverSitemapUrls(origin: string): Promise<string[]> {
  const urls: string[] = [];
  const sitemapUrls = await findSitemapUrls(origin);

  for (const sitemapUrl of sitemapUrls) {
    const parsed = await parseSitemap(sitemapUrl);
    urls.push(...parsed);
  }

  return [...new Set(urls)];
}

/**
 * Find sitemap URLs from:
 *  1. robots.txt Sitemap: directives
 *  2. Fallback to /sitemap.xml if no Sitemap directive found
 */
async function findSitemapUrls(origin: string): Promise<string[]> {
  const urls: string[] = [];

  try {
    const res = await fetch(new URL('/robots.txt', origin), {
      headers: { 'user-agent': process.env.CRAWLER_USER_AGENT ?? 'SiteHarvestBot/0.1' },
    });
    if (res.ok) {
      const text = await res.text();
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.split('#')[0].trim();
        const [key, ...rest] = line.split(':');
        if (!key) continue;
        const value = rest.join(':').trim();
        if (key.toLowerCase() === 'sitemap' && value) urls.push(value);
      }
    }
  } catch {
    // robots.txt failure is non-fatal
  }

  // Fallback: try /sitemap.xml if no Sitemap directive was found
  if (urls.length === 0) {
    urls.push(new URL('/sitemap.xml', origin).toString());
  }

  return urls;
}

/**
 * Parse an XML sitemap (or sitemap index) and return page URLs.
 * Handles both <url><loc> and <sitemap><loc> (recursive index).
 */
async function parseSitemap(sitemapUrl: string): Promise<string[]> {
  try {
    const res = await fetch(sitemapUrl, {
      headers: {
        'user-agent': process.env.CRAWLER_USER_AGENT ?? 'SiteHarvestBot/0.1',
        accept: 'application/xml,text/xml,*/*',
      },
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const urls: string[] = [];

    // Detect sitemap index (contains <sitemap><loc>... entries)
    const sitemapRefs = xml.match(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>/gi);
    if (sitemapRefs) {
      for (const ref of sitemapRefs) {
        const loc = ref.match(/<loc>([^<]+)<\/loc>/i)?.[1];
        if (loc) {
          const nested = await parseSitemap(loc.trim());
          urls.push(...nested);
        }
      }
      return urls;
    }

    // Regular sitemap: extract <url><loc> entries
    const locs = xml.match(/<loc>([^<]+)<\/loc>/gi);
    if (locs) {
      for (const match of locs) {
        const loc = match.match(/<loc>([^<]+)<\/loc>/i)?.[1];
        if (loc) urls.push(loc.trim());
      }
    }

    return urls;
  } catch {
    return [];
  }
}
