import { Fetcher } from '../core/fetcher.js';
import { detectTechnologies } from '../detectors/tech.js';
import { extractGeneric } from '../extractors/generic.js';
import { selectAdapter } from '../adapters/registry.js';

export async function inspectCommand(url: string) {
  const fetched = await new Fetcher().get(url);
  const technologies = detectTechnologies(fetched.html, fetched.headers);
  const page = extractGeneric(fetched.url, fetched.html, technologies);
  const adapter = selectAdapter(fetched.url, technologies);
  console.log(JSON.stringify({
    url: fetched.url,
    status: fetched.status,
    contentType: fetched.contentType,
    adapter: adapter.name,
    technologies,
    title: page.title,
    breadcrumbs: page.breadcrumbs,
    product: page.product,
    linkCount: page.links.length,
    sampleLinks: page.links.slice(0, 20),
  }, null, 2));
}
