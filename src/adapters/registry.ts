import type { ExtractedPage } from '../types/domain.js';
import type { SiteAdapter } from './types.js';
import { genericAdapter } from './generic.js';

const darukadeAdapter: SiteAdapter = {
  name: 'darukade',
  matches: (url) => {
    try { return new URL(url).hostname.endsWith('darukade.com'); } catch { return false; }
  },
  discoverUrls: (page) => page.links,
};

const adapters: SiteAdapter[] = [darukadeAdapter];

export function selectAdapter(url: string, technologies: ExtractedPage['technologies']): SiteAdapter {
  return adapters.find((adapter) => adapter.matches(url, technologies)) ?? genericAdapter;
}
