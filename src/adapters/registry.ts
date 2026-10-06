import type { ExtractedPage } from '../types/domain.js';
import type { SiteAdapter } from './types.js';
import { genericAdapter } from './generic.js';
import { darukadeAdapter } from './darukade.js';

const adapters: SiteAdapter[] = [darukadeAdapter];

export function selectAdapter(url: string, technologies: ExtractedPage['technologies']): SiteAdapter {
  return adapters.find((adapter) => adapter.matches(url, technologies)) ?? genericAdapter;
}
