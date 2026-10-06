#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { detectCommand } from "./commands/detect.js";
import { dbInitCommand } from "./commands/db.js";
import { crawlCommand } from "./commands/crawl.js";
import { exportCommand } from "./commands/export.js";
import { inspectCommand } from "./commands/inspect.js";
import { fixCommandCli } from "./commands/fix.js";
import { dedupeCategoriesCli } from "./commands/dedupe-categories.js";
import { fixCategoriesCli } from "./commands/fix-categories.js";

const program = new Command();
program
  .name("siteharvest")
  .description(
    "Discover, normalize and persist website catalog data for developers and AI systems.",
  )
  .version("0.1.0");

program
  .command("detect <url>")
  .description("Detect likely technologies used by a website (framework, CMS, ecommerce, analytics, etc.)")
  .action(detectCommand);

program
  .command("db:init")
  .description("Create/update the SiteHarvest schema in a Supabase Postgres database (run migrations).")
  .action(dbInitCommand);

program
  .command("inspect <url>")
  .description("Inspect a URL: show detected technology, selected adapter, and extracted structured data (products, categories, ingredients) without writing to the database.")
  .action(inspectCommand);

program
  .command("crawl [options] <url>")
  .description("Crawl a same-origin website and persist discovered pages/products to Supabase.")
  .option("--max-pages <number>", "Maximum pages to crawl", "100")
  .option("--resume <crawl-id>", "Resume an existing crawl run")
  .option("--concurrency <number>", "Maximum simultaneous fetches", process.env.CRAWLER_CONCURRENCY ?? "3")
  .option("--batch-size <number>", "Queue claim and transaction batch size", process.env.CRAWLER_FLUSH_BATCH ?? "20")
  .option("--store-raw-html", "Store raw HTML in the pages table (enables re-processing later)", false)
  .option("--product-only", "Only crawl product-detail and catalog pages (skip blog, about, etc.)", false)
  .action((url, options) =>
    crawlCommand(
      url,
      Number(options.maxPages),
      options.resume,
      Number(options.concurrency),
      Number(options.batchSize),
      options.storeRawHtml,
      options.productOnly,
    ),
  );

program
  .command("export [options] <output>")
  .description("Export normalized products as JSON for downstream applications/AI pipelines.")
  .option("--limit <number>", "Maximum products to export", "1000")
  .action((output, options) => exportCommand(output, Number(options.limit)));

fixCommandCli(program);
dedupeCategoriesCli(program);
fixCategoriesCli(program);

await program.parseAsync();
