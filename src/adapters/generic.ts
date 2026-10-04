import type { SiteAdapter } from './types.js';

export const genericAdapter: SiteAdapter = {
  name: 'generic',
  matches: () => true,
  discoverUrls: (page) => page.links,
};
