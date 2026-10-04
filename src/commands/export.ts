import { supabaseClient } from '../db/client.js';
import { writeFile } from 'node:fs/promises';

export async function exportCommand(output: string, limit: number) {
  const supabase = supabaseClient();
  const { data, error } = await supabase.from('products').select('id,source_id,canonical_url,name,brand,description,sku,barcode,price,currency,availability,manufacturer,form,package_size,image_urls,attributes,created_at,updated_at').limit(limit);
  if (error) throw error;
  await writeFile(output, JSON.stringify(data ?? [], null, 2));
  console.log(`✓ Exported ${(data ?? []).length} products to ${output}`);
}
