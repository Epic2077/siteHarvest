export class RobotsPolicy {
  private disallowed: string[] = [];
  private loaded = false;

  async load(origin: string): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const response = await fetch(new URL('/robots.txt', origin), {
        headers: { 'user-agent': process.env.CRAWLER_USER_AGENT ?? 'SiteHarvestBot/0.1' },
      });
      if (!response.ok) return;
      const text = await response.text();
      let applies = false;
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.split('#')[0].trim();
        const [key, ...rest] = line.split(':');
        if (!key) continue;
        const value = rest.join(':').trim();
        if (key.toLowerCase() === 'user-agent') applies = value === '*' || value.toLowerCase().includes('siteharvest');
        if (applies && key.toLowerCase() === 'disallow' && value) this.disallowed.push(value);
      }
    } catch {
      // A robots.txt fetch failure does not block crawling; terms/licensing must still be checked separately.
    }
  }

  isAllowed(url: string): boolean {
    try {
      const path = new URL(url).pathname;
      return !this.disallowed.some((rule) => path.startsWith(rule));
    } catch { return false; }
  }
}
