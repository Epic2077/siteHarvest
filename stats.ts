import { supabaseClient } from './src/db/client.js';
const sb = supabaseClient();

const { count: products } = await sb.from('products').select('*', { count: 'exact', head: true });
const { count: ingredients } = await sb.from('ingredients').select('*', { count: 'exact', head: true });
const { count: productIngredients } = await sb.from('product_ingredients').select('*', { count: 'exact', head: true });
const { count: categories } = await sb.from('categories').select('*', { count: 'exact', head: true });
const { count: productCategories } = await sb.from('product_categories').select('*', { count: 'exact', head: true });
const { count: pages } = await sb.from('pages').select('*', { count: 'exact', head: true });

console.log('Pages:', pages);
console.log('Products:', products);
console.log('Ingredients:', ingredients);
console.log('Product-Ingredients (links):', productIngredients);
console.log('Categories:', categories);
console.log('Product-Categories (links):', productCategories);

// Check avg ingredients per product
const { data: piStats } = await sb
  .from('product_ingredients')
  .select('product_id');

const prodIngMap = new Map<string, number>();
for (const row of piStats ?? []) {
  prodIngMap.set(row.product_id, (prodIngMap.get(row.product_id) || 0) + 1);
}
const avgIng = prodIngMap.size > 0 
  ? Array.from(prodIngMap.values()).reduce((a, b) => a + b, 0) / prodIngMap.size 
  : 0;
console.log('\nAvg ingredients per product:', avgIng.toFixed(2));
console.log('Products with ingredients:', prodIngMap.size);

// Check avg categories per product
const { data: pcStats } = await sb
  .from('product_categories')
  .select('product_id');

const prodCatMap = new Map<string, number>();
for (const row of pcStats ?? []) {
  prodCatMap.set(row.product_id, (prodCatMap.get(row.product_id) || 0) + 1);
}
const avgCat = prodCatMap.size > 0
  ? Array.from(prodCatMap.values()).reduce((a, b) => a + b, 0) / prodCatMap.size
  : 0;
console.log('Avg categories per product:', avgCat.toFixed(2));
console.log('Products with categories:', prodCatMap.size);

// Category types breakdown
const { data: catTypes } = await sb
  .from('categories')
  .select('name, source_url')
  .limit(1000);

const breadcrumbCats = new Set<string>();
const productCats = new Set<string>();
for (const c of catTypes ?? []) {
  if (c.source_url?.includes('/products/')) {
    // Check if it's a product detail page or category page
    const path = new URL(c.source_url).pathname;
    if (path.match(/\/products\/[^\/]+\/[^\/]+/)) {
      productCats.add(c.name);
    } else {
      breadcrumbCats.add(c.name);
    }
  }
}
console.log('\nCategory name types (sample):');
console.log('  Breadcrumb/hierarchy categories:', breadcrumbCats.size);
console.log('  Product-specific categories:', productCats.size);