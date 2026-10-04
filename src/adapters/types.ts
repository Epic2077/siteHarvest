import type { ExtractedPage, ProductRecord } from '../types/domain.js';

export interface SiteAdapter {
  name: string;
  matches(url: string, technologies: ExtractedPage['technologies']): boolean;
  discoverUrls(page: ExtractedPage): string[];
  refineProduct?(product: ProductRecord, page: ExtractedPage): Promise<ProductRecord> | ProductRecord;
}
