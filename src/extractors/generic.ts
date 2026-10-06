import * as cheerio from 'cheerio';
import type { CategoryRecord, ExtractedPage, IngredientRecord, PagePartition, ProductRecord } from '../types/domain.js';

const absolute = (value: string | undefined, base: string): string | undefined => {
  if (!value) return undefined;
  try { return new URL(value, base).toString(); } catch { return undefined; }
};

function clean(value: string | undefined): string | undefined {
  const v = value?.replace(/\s+/g, ' ').trim();
  return v || undefined;
}

function jsonLd($: cheerio.CheerioAPI): unknown[] {
  const result: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      if (Array.isArray(parsed)) result.push(...parsed); else result.push(parsed);
    } catch { /* malformed JSON-LD is ignored */ }
  });
  return result;
}

function extractPartitions($: cheerio.CheerioAPI, url: string): { partitions: PagePartition[]; textContent?: string } {
  const partitions: PagePartition[] = [];
  let order = 0;
  const metadata = {
    url,
    title: clean($('title').text()),
    description: clean($('meta[name="description"]').attr('content')),
    language: clean($('html').attr('lang')),
    canonicalUrl: absolute($('link[rel="canonical"]').attr('href'), url),
    openGraph: Object.fromEntries(
      $('meta[property^="og:"]').toArray().flatMap((el): [string, string][] => {
        const property = $(el).attr('property');
        const content = clean($(el).attr('content'));
        return property && content ? [[property, content]] : [];
      }),
    ),
  };
  partitions.push({ type: 'metadata', order: order++, data: metadata });

  for (const node of jsonLd($)) partitions.push({ type: 'json-ld', order: order++, data: node });

  $('table').each((_, table) => {
    const rows = $(table).find('tr').map((__, row) =>
      $(row).find('th,td').map((___, cell) => clean($(cell).text())).get().filter(Boolean),
    ).get().filter((row) => row.length > 0);
    if (rows.length) partitions.push({
      type: 'table',
      order: order++,
      heading: clean($(table).find('caption').first().text()),
      data: { headers: rows[0], rows: rows.slice(1) },
    });
  });

  $('main, article').find('ul,ol').each((_, list) => {
    const items = $(list).children('li').map((__, item) => clean($(item).text())).get().filter(Boolean);
    if (items.length >= 2) partitions.push({ type: 'list', order: order++, data: items });
  });

  const contentRoot = $('main').first().length ? $('main').first() : ($('article').first().length ? $('article').first() : $('body'));
  contentRoot.find('script,style,noscript,svg,form,nav,footer,header,aside').remove();
  const headings = contentRoot.find('h1,h2,h3,h4,h5,h6').toArray();
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const level = Number(heading.tagName.slice(1));
    const pieces: string[] = [];
    let node = $(heading).next();
    while (node.length && !/^h[1-6]$/i.test(node[0]?.tagName ?? '')) {
      const value = clean(node.text());
      if (value) pieces.push(value);
      node = node.next();
    }
    const text = clean(pieces.join(' '));
    if (text) partitions.push({
      type: 'section',
      order: order++,
      heading: clean($(heading).text()),
      text,
      data: { level },
    });
  }

  const textContent = clean(contentRoot.text());
  if (!partitions.some((partition) => partition.type === 'section') && textContent) {
    partitions.push({ type: 'section', order: order++, heading: clean($('h1').first().text()), text: textContent });
  }
  return { partitions, textContent };
}

function findProduct(nodes: unknown[]): Record<string, any> | undefined {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, any>;
    if (obj['@type'] === 'Product' || (Array.isArray(obj['@type']) && obj['@type'].includes('Product'))) return obj;
    if (Array.isArray(obj['@graph'])) {
      const found = findProduct(obj['@graph']);
      if (found) return found;
    }
  }
  return undefined;
}

function breadcrumbs($: cheerio.CheerioAPI): string[] {
  const selectors = [
    '[aria-label*="breadcrumb" i] a',
    '.breadcrumb a',
    '.breadcrumbs a',
    'nav[aria-label*="breadcrumb" i] a',
    '[itemtype*="BreadcrumbList"] [itemprop="name"]',
  ];
  for (const selector of selectors) {
    const values = $(selector).map((_, el) => clean($(el).text())).get().filter(Boolean) as string[];
    if (values.length) return [...new Set(values)];
  }
  return [];
}

function productFromPage($: cheerio.CheerioAPI, url: string, crumbs: string[]): ProductRecord | undefined {
  const ld = findProduct(jsonLd($));
  const name = clean(ld?.name) ?? clean($('meta[property="og:title"]').attr('content')) ?? clean($('h1').first().text());
  if (!name) return undefined;

  const description = clean(ld?.description) ?? clean($('meta[name="description"]').attr('content'));
  const images = (Array.isArray(ld?.image) ? ld.image : [ld?.image]).map((x) => typeof x === 'string' ? absolute(x, url) : undefined).filter(Boolean) as string[];
  const offers = Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers;
  const brand = typeof ld?.brand === 'string' ? ld.brand : ld?.brand?.name;
  const ingredientsText = $('[class*="ingredient" i], [id*="ingredient" i]').text();
  const ingredients: IngredientRecord[] = [];
  if (ingredientsText) {
    for (const piece of ingredientsText.split(/[\n,،•]+/).map((x) => clean(x)).filter(Boolean)) {
      ingredients.push({ name: piece as string });
    }
  }

  return {
    canonicalUrl: absolute($('link[rel="canonical"]').attr('href'), url) ?? url,
    name,
    brand: clean(brand),
    description,
    categoryNames: crumbs.length ? [crumbs[crumbs.length - 1]] : [],
    breadcrumbs: crumbs,
    imageUrls: [...new Set(images)],
    sku: clean(ld?.sku),
    barcode: clean(ld?.gtin13 ?? ld?.gtin12 ?? ld?.gtin14 ?? ld?.gtin),
    price: typeof offers?.price === 'number' ? offers.price : Number.isFinite(Number(offers?.price)) ? Number(offers.price) : undefined,
    currency: clean(offers?.priceCurrency),
    availability: clean(offers?.availability),
    manufacturer: clean(ld?.manufacturer?.name ?? ld?.manufacturer),
    ingredients,
    attributes: {},
    source: { url, extractedAt: new Date().toISOString() },
  };
}

export function extractGeneric(url: string, html: string, technologies: ExtractedPage['technologies']): ExtractedPage {
  const $ = cheerio.load(html);
  const crumbs = breadcrumbs($);
  const ldNodes = jsonLd($);
  const hasProductJsonLd = Boolean(findProduct(ldNodes));
  const hasProductSignals = $('meta[property="product:price:amount"], [itemprop="price"], [class*="price" i]').length > 0;
  const looksLikeProductUrl = /\/(products?|item|p|prd)[\/_-]/i.test(new URL(url).pathname);
  console.debug(`[extractGeneric] ${url} hasProductJsonLd=${hasProductJsonLd} hasProductSignals=${hasProductSignals} looksLikeProductUrl=${looksLikeProductUrl} ldNodes=${ldNodes.length}`);
  const product = (hasProductJsonLd || (hasProductSignals && looksLikeProductUrl)) ? productFromPage($, url, crumbs) : undefined;
  const links = $('a[href]').map((_, el) => absolute($(el).attr('href'), url)).get().filter(Boolean) as string[];
  const uniqueLinks = [...new Set(links)];
  const category: CategoryRecord | undefined = !product && crumbs.length
    ? { name: crumbs[crumbs.length - 1], parentName: crumbs.at(-2), sourceUrl: url, breadcrumbs: crumbs }
    : undefined;
  const structured = extractPartitions($, url);

  return {
    url,
    title: clean($('title').text()),
    description: clean($('meta[name="description"]').attr('content')),
    canonicalUrl: absolute($('link[rel="canonical"]').attr('href'), url),
    breadcrumbs: crumbs,
    technologies,
    category,
    product,
    partitions: structured.partitions,
    textContent: structured.textContent,
    links: uniqueLinks,
    rawHtml: html,
  };
}
