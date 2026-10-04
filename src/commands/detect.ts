import { Fetcher } from '../core/fetcher.js';
import { detectTechnologies } from '../detectors/tech.js';

export async function detectCommand(url: string) {
  const fetched = await new Fetcher().get(url);
  const technologies = detectTechnologies(fetched.html, fetched.headers);
  console.log(JSON.stringify({ url: fetched.url, status: fetched.status, contentType: fetched.contentType, technologies }, null, 2));
}
