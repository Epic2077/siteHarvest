import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

export function supabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Extract the Supabase project reference from SUPABASE_URL.
 * e.g. https://bkdetotliaillrgxcdyc.supabase.co → bkdetotliaillrgxcdyc
 */
export function projectRef(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('SUPABASE_URL is required.');
  const match = url.match(/^https?:\/\/([^.]+)\.supabase\.co/);
  if (!match?.[1]) throw new Error(`Could not extract project ref from SUPABASE_URL: ${url}`);
  return match[1];
}

/**
 * Execute arbitrary SQL against the Supabase project via the Management API.
 * Requires SUPABASE_ACCESS_TOKEN (personal access token from Supabase Dashboard > Account > Access Tokens).
 */
export async function executeSql(sql: string): Promise<unknown[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required for database initialization. Create one at https://supabase.com/dashboard/account/tokens');

  const ref = projectRef();
  const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/query`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase Management API error (${res.status}): ${body}`);
  }

  return (await res.json()) as unknown[];
}
