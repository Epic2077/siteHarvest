import * as cheerio from 'cheerio';
import type { CategoryRecord, ExtractedPage, IngredientRecord, ProductRecord } from '../types/domain.js';

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
  const hasProductJsonLd = Boolean(findProduct(jsonLd($)));
  const hasProductSignals = $('meta[property="product:price:amount"], [itemprop="price"], [class*="price" i]').length > 0;
  const looksLikeProductUrl = /\/(product|item|p|prd)[\/_-]/i.test(new URL(url).pathname);
  const product = (hasProductJsonLd || (hasProductSignals && looksLikeProductUrl)) ? productFromPage($, url, crumbs) : undefined;
  const links = $('a[href]').map((_, el) => absolute($(el).attr('href'), url)).get().filter(Boolean) as string[];
  const uniqueLinks = [...new Set(links)];
  const category: CategoryRecord | undefined = !product && crumbs.length
    ? { name: crumbs[crumbs.length - 1], parentName: crumbs.at(-2), sourceUrl: url, breadcrumbs: crumbs }
    : undefined;

  return {
    url,
    title: clean($('title').text()),
    description: clean($('meta[name="description"]').attr('content')),
    canonicalUrl: absolute($('link[rel="canonical"]').attr('href'), url),
    breadcrumbs: crumbs,
    technologies,
    category,
    product,
    links: uniqueLinks,
    rawHtml: html,
  };
}
