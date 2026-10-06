import { supabaseClient } from './src/db/client.js';
const sb = supabaseClient();

const { count: products } = await sb.from('products').select('*', { count: 'exact', head: true });
const { count: ingredients } = await sb.from('ingredients').select('*', { count: 'exact', head: true });
const { count: productIngredients } = await sb.from('product_ingredients').select('*', { count: 'exact', head: true });
const { count: categories } = await sb.from('categories').select('*', { count: 'exact', head: true });
const { count: productCategories } = await sb.from('product_categories').select('*', { count: 'exact', head: true });

console.log('Products:', products);
console.log('Ingredients:', ingredients);
console.log('Product Ingredients:', productIngredients);
console.log('Categories:', categories);
console.log('Product Categories:', productCategories);