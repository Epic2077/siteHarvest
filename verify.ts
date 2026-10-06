import { supabaseClient } from './src/db/client.js';
const sb = supabaseClient();
const { data: products, error: pErr } = await sb.from('products').select('*').limit(5);
const { data: ingredients, error: iErr } = await sb.from('ingredients').select('*').limit(5);
const { data: productIngredients, error: piErr } = await sb.from('product_ingredients').select('*').limit(5);
const { data: categories, error: cErr } = await sb.from('categories').select('*').limit(5);
const { data: productCategories, error: pcErr } = await sb.from('product_categories').select('*').limit(5);

console.log('Products:', products?.length, pErr);
console.log('Ingredients:', ingredients?.length, iErr);
console.log('Product Ingredients:', productIngredients?.length, piErr);
console.log('Categories:', categories?.length, cErr);
console.log('Product Categories:', productCategories?.length, pcErr);

if (products?.[0]) console.log('\nSample product:', JSON.stringify(products[0], null, 2));
if (ingredients?.[0]) console.log('\nSample ingredient:', JSON.stringify(ingredients[0], null, 2));
if (productIngredients?.[0]) console.log('\nSample product_ingredient:', JSON.stringify(productIngredients[0], null, 2));