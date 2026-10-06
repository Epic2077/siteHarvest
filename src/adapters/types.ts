import type { ExtractedPage, ProductRecord } from '../types/domain.js';

export type UrlClassification = 'product' | 'discovery' | 'reject';

export interface SiteAdapter {
  name: string;
  matches(url: string, technologies: ExtractedPage['technologies']): boolean;
  discoverUrls(page: ExtractedPage): string[];
  refineProduct?(product: ProductRecord, page: ExtractedPage): Promise<ProductRecord> | ProductRecord;
  /**
   * Classify a URL for product-only crawl scoping.
   *  - 'product': a product detail page worth extracting product data from.
   *  - 'discovery': a navigation/listing page to crawl for links only.
   *  - 'reject': irrelevant to product ingestion; skip entirely.
   * When omitted, the crawler treats every URL as 'product'.
   */
  classifyUrl?(url: string): UrlClassification;
}
