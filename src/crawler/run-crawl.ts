#!/usr/bin/env tsx
/**
 * CLI entry point for running the crawler.
 *
 * Usage:
 *   tsx src/crawler/run-crawl.ts                         # crawl all subjects K-12
 *   tsx src/crawler/run-crawl.ts --subject adst          # crawl ADST only
 *   tsx src/crawler/run-crawl.ts --all --force            # re-crawl everything
 *   tsx src/crawler/run-crawl.ts --subject science --grade-from 10 --grade-to 12
 *   tsx src/crawler/run-crawl.ts --refs-only              # only crawl reference pages
 *   tsx src/crawler/run-crawl.ts --no-refs                # skip reference pages
 */

import { runCrawl, type CrawlOptions } from "./crawl.js";
import { closeDb } from "../services/database.js";

function parseArgs(): Partial<CrawlOptions> & { refsOnly?: boolean } {
  const args = process.argv.slice(2);
  const options: Partial<CrawlOptions> & { refsOnly?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--subject":
        if (next) {
          options.subjects = options.subjects || [];
          options.subjects.push(next);
          i++;
        }
        break;
      case "--all":
        options.subjects = [];
        break;
      case "--force":
        options.force = true;
        break;
      case "--grade-from":
        if (next) {
          const val = next.toLowerCase();
          options.gradeFrom = val === "k" ? 0 : parseInt(val);
          i++;
        }
        break;
      case "--grade-to":
        if (next) {
          options.gradeTo = parseInt(next);
          i++;
        }
        break;
      case "--delay":
        if (next) {
          options.delayMs = parseInt(next);
          i++;
        }
        break;
      case "--headed":
        options.headless = false;
        break;
      case "--refs-only":
        options.refsOnly = true;
        options.includeReferences = true;
        break;
      case "--no-refs":
        options.includeReferences = false;
        break;
      case "--help":
        console.log(`
BC Curriculum Crawler (K-12)

Usage:
  tsx src/crawler/run-crawl.ts [options]
  node dist/crawler/run-crawl.js [options]

Options:
  --subject <slug>    Crawl a specific subject (can be repeated)
  --all               Crawl all subjects (default)
  --force             Re-crawl pages that already exist
  --grade-from <n>    Start grade (default: K). Use "k" for Kindergarten.
  --grade-to <n>      End grade (default: 12)
  --delay <ms>        Delay between requests in ms (default: 1500)
  --headed            Run browser in headed mode (visible)
  --refs-only         Only crawl reference pages (Core Competencies, FPPL, etc.)
  --no-refs           Skip reference pages
  --help              Show this help

Subjects:
  adst, arts-education, career-education, english-language-arts,
  languages, mathematics, physical-health-education, science, social-studies

Examples:
  # Full K-12 crawl (all subjects + reference pages)
  node dist/crawler/run-crawl.js --all

  # Quick test: just ADST grades 8-10
  node dist/crawler/run-crawl.js --subject adst --grade-from 8 --grade-to 10

  # Re-crawl science, force refresh
  node dist/crawler/run-crawl.js --subject science --force

  # Only crawl Core Competencies, FPPL, Assessment resources
  node dist/crawler/run-crawl.js --refs-only
        `);
        process.exit(0);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const { refsOnly, ...options } = parseArgs();

  // If refs-only, set grade range to skip course crawling
  if (refsOnly) {
    // Set gradeFrom > gradeTo to skip the course loop
    options.gradeFrom = 99;
    options.gradeTo = 0;
    options.includeReferences = true;
  }

  try {
    await runCrawl(options);
  } catch (err) {
    console.error("Crawl failed:", err);
    process.exit(1);
  } finally {
    closeDb();
  }
}

main();
