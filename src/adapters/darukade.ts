import * as cheerio from 'cheerio';
import type { IngredientRecord, ProductRecord } from '../types/domain.js';
import type { SiteAdapter, UrlClassification } from './types.js';

type DarukadeBreadcrumb = {
  title?: string;
  url?: string;
};

type DarukadeIngredient = {
  faName?: string;
  enName?: string;
  amount?: string;
};

type DarukadeProductData = {
  section1Data?: {
    productCode?: string;
    faName?: string;
    enName?: string;
    brandFaName?: string;
    brandEnName?: string;
    breadCrumb?: DarukadeBreadcrumb[];
    slaves?: { items?: Array<{ images?: Array<{ image?: string }> }> };
  };
  section2Data?: {
    ingredients?: DarukadeIngredient[];
    ingredientperuse?: string;
  };
  section3Data?: {
    description?: string;
  };
};

const clean = (value: string | undefined): string | undefined => {
  const result = value?.replace(/\s+/g, ' ').trim();
  return result || undefined;
};

function htmlText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const $ = cheerio.load(html);
  $('br').replaceWith(' ');
  $('p,li,h1,h2,h3,h4,h5,h6').each((_, element) => {
    $(element).append(' ');
  });
  return clean($.root().text());
}

function parseAmount(value: string | undefined): Pick<IngredientRecord, 'amount' | 'unit'> {
  if (!value) return {};
  const normalized = value
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/,/g, '');
  const match = normalized.match(/(-?\d+(?:\.\d+)?)\s*(.*)/);
  if (!match) return {};
  const amount = Number(match[1]);
  return {
    amount: Number.isFinite(amount) ? amount : undefined,
    unit: clean(match[2]),
  };
}

function hydrationData(html: string | undefined): DarukadeProductData | undefined {
  if (!html) return undefined;
  const $ = cheerio.load(html);
  const payload = $('#__NEXT_DATA__').contents().text();
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(payload) as { props?: { pageProps?: DarukadeProductData } };
    return parsed.props?.pageProps;
  } catch {
    return undefined;
  }
}

function refineDarukadeProduct(product: ProductRecord, html: string | undefined): ProductRecord {
  const data = hydrationData(html);
  const summary = data?.section1Data;
  if (!summary) return product;

  const breadcrumbItems = summary.breadCrumb ?? [];
  const breadcrumbs = breadcrumbItems.map((item) => clean(item.title)).filter(Boolean) as string[];
  const categoryNames = breadcrumbItems
    .slice(1, -1)
    .map((item) => clean(item.title))
    .filter(Boolean) as string[];
  const ingredients = (data?.section2Data?.ingredients ?? []).flatMap((ingredient): IngredientRecord[] => {
    const name = clean(ingredient.faName) ?? clean(ingredient.enName);
    return name ? [{ name, ...parseAmount(ingredient.amount) }] : [];
  });
  const imageUrls = (summary.slaves?.items ?? [])
    .flatMap((item) => item.images ?? [])
    .map((image) => clean(image.image))
    .filter(Boolean) as string[];
  const description = htmlText(data?.section3Data?.description);
  const ingredientServing = clean(data?.section2Data?.ingredientperuse);
  const englishName = clean(summary.enName);

  return {
    ...product,
    name: clean(summary.faName) ?? product.name,
    brand: clean(summary.brandEnName) ?? clean(summary.brandFaName) ?? product.brand,
    description: description ?? product.description,
    categoryNames: categoryNames.length ? [...new Set(categoryNames)] : product.categoryNames,
    breadcrumbs: breadcrumbs.length ? breadcrumbs : product.breadcrumbs,
    imageUrls: imageUrls.length ? [...new Set(imageUrls)] : product.imageUrls,
    sku: clean(summary.productCode) ?? product.sku,
    ingredients: ingredients.length ? ingredients : product.ingredients,
    attributes: {
      ...product.attributes,
      ...(englishName ? { englishName } : {}),
      ...(ingredientServing ? { ingredientServing } : {}),
    },
  };
}

/**
 * Darukade URL classification for product-only crawl scoping.
 *
 * Product detail pages: /products/<product-slug>
 *   e.g. /products/ferrous-sulfate-tablet-24101
 *
 * Discovery/listing pages:
 *   - /products              (catalog root)
 *   - /products?page=N       (pagination)
 *   - /products/category/... (category navigation)
 *   - /products/brand/...    (brand navigation)
 *   - any multi-segment path under /products/ with known sub-prefixes
 *
 * Everything else: reject (blog, about, contact, etc.)
 */
const NON_PRODUCT_PREFIXES = [
  'category', 'categories', 'brand', 'brands',
  'tag', 'tags', 'page', 'search', 'filter',
  'sort', 'compare', 'wishlist', 'cart', 'checkout',
  'login', 'register', 'account',
];

function classifyDarukadeUrl(url: string): UrlClassification {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'reject';
  }

  const path = parsed.pathname.replace(/\/+$/, '');

  // Exact catalog root → discovery
  if (path === '/products' || path === '') {
    return path === '/products' ? 'discovery' : 'reject';
  }

  // Must be under /products/
  if (!path.startsWith('/products/')) return 'reject';

  // Extract the portion after /products/
  const remainder = path.slice('/products/'.length);
  const segments = remainder.split('/').filter(Boolean);

  // No segments after /products/ (shouldn't happen after trim, but be safe)
  if (segments.length === 0) return 'discovery';

  // Single segment: likely a product detail page, unless it's a known non-product keyword
  if (segments.length === 1) {
    const seg = segments[0].toLowerCase();
    if (NON_PRODUCT_PREFIXES.includes(seg)) return 'discovery';
    return 'product';
  }

  // Multi-segment: if first segment is a known navigation prefix → discovery
  const firstSeg = segments[0].toLowerCase();
  if (NON_PRODUCT_PREFIXES.includes(firstSeg)) return 'discovery';

  // Multi-segment with unknown prefix: treat as discovery (category sub-paths, etc.)
  return 'discovery';
}

export const darukadeAdapter: SiteAdapter = {
  name: 'darukade',
  matches: (url) => {
    try { return new URL(url).hostname.endsWith('darukade.com'); } catch { return false; }
  },
  discoverUrls: (page) => page.links,
  refineProduct: (product, page) => refineDarukadeProduct(product, page.rawHtml),
  classifyUrl: classifyDarukadeUrl,
};