import type { ExtractedPage } from '../types/domain.js';
import { supabaseClient } from './client.js';

export async function createSource(baseUrl: string, technologies: ExtractedPage['technologies']) {
  const supabase = supabaseClient();
  const { data, error } = await supabase.from('sources').upsert({ base_url: baseUrl, technologies }, { onConflict: 'base_url' }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

export async function persistPage(sourceId: string, page: ExtractedPage) {
  const supabase = supabaseClient();
  const { data: pageRow, error: pageError } = await supabase.from('pages').upsert({
    source_id: sourceId,
    url: page.url,
    canonical_url: page.canonicalUrl ?? page.url,
    title: page.title,
    description: page.description,
    content_type: 'text/html',
    raw_html: page.rawHtml,
    technologies: page.technologies,
  }, { onConflict: 'url' }).select('id').single();
  if (pageError) throw pageError;

  if (page.category) {
    await supabase.from('categories').upsert({
      source_id: sourceId,
      name: page.category.name,
      parent_name: page.category.parentName,
      source_url: page.category.sourceUrl,
      breadcrumbs: page.category.breadcrumbs,
    }, { onConflict: 'source_id,name,source_url' });
  }

  if (page.product) {
    const p = page.product;
    const { data: product, error: productError } = await supabase.from('products').upsert({
      source_id: sourceId,
      source_page_id: pageRow.id,
      canonical_url: p.canonicalUrl,
      name: p.name,
      brand: p.brand,
      description: p.description,
      sku: p.sku,
      barcode: p.barcode,
      price: p.price,
      currency: p.currency,
      availability: p.availability,
      manufacturer: p.manufacturer,
      form: p.form,
      package_size: p.packageSize,
      image_urls: p.imageUrls,
      attributes: p.attributes,
      source_payload: p,
    }, { onConflict: 'source_id,canonical_url' }).select('id').single();
    if (productError) throw productError;

    for (const categoryName of p.categoryNames) {
      const { data: category, error: categoryError } = await supabase
        .from('categories')
        .select('id')
        .eq('source_id', sourceId)
        .eq('name', categoryName)
        .limit(1)
        .maybeSingle();
      if (categoryError) throw categoryError;
      if (category) {
        const { error: linkError } = await supabase.from('product_categories').upsert({ product_id: product.id, category_id: category.id });
        if (linkError) throw linkError;
      }
    }

    for (const ingredient of p.ingredients) {
      const { data: ing, error: ingError } = await supabase.from('ingredients').upsert({ canonical_name: ingredient.name, metadata: { source: 'raw-extraction' } }, { onConflict: 'canonical_name' }).select('id').single();
      if (ingError) throw ingError;
      await supabase.from('product_ingredients').upsert({ product_id: product.id, ingredient_id: ing.id, amount: ingredient.amount, unit: ingredient.unit, form: ingredient.form, raw_name: ingredient.name }, { onConflict: 'product_id,ingredient_id' });
    }
  }
}
