import * as cheerio from 'cheerio';
import type { Technology } from '../types/domain.js';

function add(map: Map<string, Technology>, tech: Technology) {
  const existing = map.get(tech.name);
  if (!existing || tech.confidence > existing.confidence) map.set(tech.name, tech);
}

export function detectTechnologies(html: string, headers: Record<string, string>): Technology[] {
  const $ = cheerio.load(html);
  const scripts = $('script[src]').map((_, el) => $(el).attr('src') ?? '').get();
  const classes = $('[class]').map((_, el) => $(el).attr('class') ?? '').get().join(' ');
  const body = html.toLowerCase();
  const map = new Map<string, Technology>();

  if (body.includes('__next_data__') || body.includes('/_next/static/') || scripts.some((s) => s.includes('/_next/'))) {
    add(map, { name: 'Next.js', category: 'framework', confidence: 0.99, evidence: ['Next.js runtime markers'] });
    add(map, { name: 'React', category: 'frontend', confidence: 0.9, evidence: ['Next.js implies React'] });
  }
  if (body.includes('wp-content') || body.includes('wp-includes') || $('meta[name="generator"][content*="WordPress"]').length) {
    add(map, { name: 'WordPress', category: 'cms', confidence: 0.99, evidence: ['WordPress asset paths or generator meta'] });
  }
  if (body.includes('woocommerce') || body.includes('wc-')) {
    add(map, { name: 'WooCommerce', category: 'ecommerce', confidence: 0.95, evidence: ['WooCommerce HTML/class markers'] });
  }
  if (body.includes('shopify') || scripts.some((s) => s.includes('cdn.shopify.com'))) {
    add(map, { name: 'Shopify', category: 'ecommerce', confidence: 0.98, evidence: ['Shopify script/domain markers'] });
  }
  if (body.includes('nuxt') || body.includes('__nuxt__')) {
    add(map, { name: 'Nuxt', category: 'framework', confidence: 0.95, evidence: ['Nuxt runtime markers'] });
  }
  if (body.includes('vue') && (body.includes('data-v-') || classes.includes('vue'))) {
    add(map, { name: 'Vue', category: 'frontend', confidence: 0.8, evidence: ['Vue markers'] });
  }

  const server = headers['server'];
  if (server) add(map, { name: server, category: 'server', confidence: 0.55, evidence: [`Server header: ${server}`] });

  const generator = $('meta[name="generator"]').attr('content');
  if (generator) add(map, { name: generator, category: 'other', confidence: 0.8, evidence: [`Generator meta: ${generator}`] });

  return [...map.values()].sort((a, b) => b.confidence - a.confidence);
}
