const TRACKING_PARAMETERS = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref|source)$/i;
const NON_HTML_EXTENSIONS = /\.(?:avif|bmp|css|csv|docx?|eot|gif|gz|ico|jpe?g|js|json|m4a|mp3|mp4|mpeg|mov|ogg|otf|pdf|png|pptx?|rar|rss|svg|tar|tiff?|ttf|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)$/i;

export function normalizeUrl(input: string, base?: string): string {
  const url = new URL(input, base);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

export function isCrawlableUrl(input: string, origin: string): boolean {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return false;
    if (NON_HTML_EXTENSIONS.test(url.pathname)) return false;
    return !['logout', 'signout', 'wp-admin', 'wp-login'].some((part) =>
      url.pathname.toLowerCase().split('/').includes(part),
    );
  } catch {
    return false;
  }
}
