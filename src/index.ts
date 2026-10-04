#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { detectCommand } from './commands/detect.js';
import { dbInitCommand } from './commands/db.js';
import { crawlCommand } from './commands/crawl.js';
import { exportCommand } from './commands/export.js';
import { inspectCommand } from './commands/inspect.js';

const program = new Command();
program
  .name('siteharvest')
  .description('Discover, normalize and persist website catalog data for developers and AI systems.')
  .version('0.1.0');

program
  .command('detect <url>')
  .description('Detect likely technologies used by a website.')
  .action(detectCommand);

program
  .command('db:init')
  .description('Create/update the SiteHarvest schema in a Supabase Postgres database.')
  .action(dbInitCommand);

program
  .command('inspect <url>')
  .description('Inspect a URL, its detected technology, adapter and extracted structured data without writing to the database.')
  .action(inspectCommand);

program
  .command('crawl <url>')
  .description('Crawl a same-origin website and persist discovered pages/products.')
  .option('--max-pages <number>', 'Maximum pages to crawl', '100')
  .action((url, options) => crawlCommand(url, Number(options.maxPages)));

program
  .command('export <output>')
  .description('Export normalized products as JSON for downstream applications/AI pipelines.')
  .option('--limit <number>', 'Maximum products', '1000')
  .action((output, options) => exportCommand(output, Number(options.limit)));

await program.parseAsync();
