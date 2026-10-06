import { supabaseClient } from './src/db/client.js';
const sb = supabaseClient();

const { data: pages, error } = await sb
  .from('pages')
  .select('id, url, source_id')
  .eq('source_id', '3017b32d-2b2c-4847-9983-da9f58722eca')
  .order('created_at', { ascending: false })
  .limit(100);

console.log('Total pages:', pages?.length);

for (const page of pages ?? []) {
  const { data: product } = await sb
    .from('products')
    .select('id')
    .eq('source_page_id', page.id)
    .limit(1);
  
  const looksLikeProduct = /\/(products?|item|p|prd)[\/_-]/i.test(new URL(page.url).pathname);
  const isCategoryPage = /\/(category|categories|brand|brands|tag|tags|page|search|filter|sort|compare|wishlist|cart|checkout|login|register|account)/i.test(new URL(page.url).pathname);
  
  if (!product || product.length === 0) {
    console.log(`NO PRODUCT: ${page.url} (looksLikeProduct=${looksLikeProduct}, isCategory=${isCategoryPage})`);
  } else {
    console.log(`HAS PRODUCT: ${page.url}`);
  }
}