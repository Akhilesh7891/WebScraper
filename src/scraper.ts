/**
 * @fileoverview Main application entry point for the Web Scraper assessment.
 *
 * Responsibilities:
 *  1. Load and validate `skus.json` input.
 *  2. Initialise output CSV (`product_data.csv`).
 *  3. Launch Playwright Chromium browser.
 *  4. Dispatch scrape jobs to Amazon/Walmart scraper modules.
 *  5. Execute jobs with bounded concurrency.
 *  6. Append all results to CSV.
 *  7. Emit operational logs and summary metrics.
 *
 * This file intentionally contains orchestration only. Site-specific scraping
 * logic is isolated in dedicated modules:
 *   - `amazonScraper.ts`
 *   - `walmartScraper.ts`
 *
 * @author  Akhilesh Chaurasia
 * @version 1.0.0
 * @since   2026-04-10
 */

import { chromium } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';

import { scrapeAmazon } from './amazonScraper';
import { scrapeWalmart } from './walmartScraper';
import { initializeCsv, appendToCsv } from './csvWriter';
import { logger } from './logger';
import { processConcurrently } from './utils';
import { ProductData, ScraperConfig, SKUEntry, SKUsFile, SourceType } from './types';

// ─── Runtime Configuration ────────────────────────────────────────────────────

/**
 * Central runtime configuration.
 *
 * Environment variable overrides:
 *  - `HEADLESS=true|false`
 *  - `TIMEOUT_MS=<number>`
 *  - `CONCURRENCY=<number>`
 */
const config: ScraperConfig = {
  headless: process.env.HEADLESS !== 'false',
  timeout: Number(process.env.TIMEOUT_MS ?? 45_000),
  retryConfig: {
    maxRetries: 3,
    initialDelayMs: 2_000,
    maxDelayMs: 20_000,
    backoffMultiplier: 2,
  },
  concurrentLimit: Number(process.env.CONCURRENCY ?? 2),
  outputCsvPath: path.resolve(process.cwd(), 'product_data.csv'),
  errorLogPath: path.resolve(process.cwd(), 'errors.log'),
};

const inputJsonPath = path.resolve(process.cwd(), 'skus.json');

// ─── Validation Helpers ───────────────────────────────────────────────────────

/**
 * Type guard for supported source values.
 */
const isValidSource = (value: unknown): value is SourceType =>
  value === 'Amazon' || value === 'Walmart';

/**
 * Validates a single raw entry from `skus.json`.
 *
 * @param raw   - Unknown JSON element.
 * @param index - Entry index (used for precise error messages).
 * @throws      If the entry is invalid.
 */
const validateSkuEntry = (raw: unknown, index: number): SKUEntry => {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Invalid SKU entry at index ${index}: expected object.`);
  }

  const maybe = raw as Partial<SKUEntry>;

  if (!isValidSource(maybe.Type)) {
    throw new Error(
      `Invalid Type at index ${index}: expected 'Amazon' or 'Walmart', got '${String(maybe.Type)}'.`,
    );
  }

  if (typeof maybe.SKU !== 'string' || maybe.SKU.trim().length === 0) {
    throw new Error(`Invalid SKU at index ${index}: non-empty string required.`);
  }

  return {
    Type: maybe.Type,
    SKU: maybe.SKU.trim(),
  };
};

/**
 * Loads and validates `skus.json` from disk.
 *
 * Expected schema:
 * ```json
 * {
 *   "skus": [
 *     { "Type": "Amazon", "SKU": "B0CT4BB651" },
 *     { "Type": "Walmart", "SKU": "5326288985" }
 *   ]
 * }
 * ```
 *
 * @param filePath - Absolute path to the `skus.json` file.
 * @returns        Validated list of SKU entries.
 * @throws         If the file is missing, malformed JSON, or schema-invalid.
 */
export const loadSkus = async (filePath: string): Promise<SKUEntry[]> => {
  const raw = await fs.readFile(filePath, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON in ${path.basename(filePath)}: ` +
      `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Partial<SKUsFile>).skus)
  ) {
    throw new Error(`Invalid schema in ${path.basename(filePath)}: 'skus' array is required.`);
  }

  const entries = (parsed as SKUsFile).skus.map((entry, idx) => validateSkuEntry(entry, idx));

  if (entries.length === 0) {
    throw new Error(`No SKU entries found in ${path.basename(filePath)}.`);
  }

  return entries;
};

// ─── Job Builder ──────────────────────────────────────────────────────────────

/**
 * Builds executable scrape jobs from validated SKU entries.
 *
 * Each job returns exactly one `ProductData` row (success or error), ensuring
 * one-row-per-input behavior in `product_data.csv`.
 */
const buildScrapeJobs = (
  skus: SKUEntry[],
  browser: Awaited<ReturnType<typeof chromium.launch>>,
): Array<() => Promise<ProductData>> => {
  return skus.map(({ Type, SKU }) => {
    if (Type === 'Amazon') {
      return () => scrapeAmazon(browser, SKU, config);
    }
    return () => scrapeWalmart(browser, SKU, config);
  });
};

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Main application function.
 *
 * Exit codes:
 *  - `0` success
 *  - `1` fatal error (validation / runtime failure)
 */
export const main = async (): Promise<void> => {
  logger.info('────────────────────────────────────────────────────────────');
  logger.info('Web Scraper Assessment Runner started');
  logger.info(`Headless mode     : ${config.headless}`);
  logger.info(`Timeout (ms)      : ${config.timeout}`);
  logger.info(`Concurrency limit : ${config.concurrentLimit}`);
  logger.info(`Input file        : ${inputJsonPath}`);
  logger.info(`Output CSV        : ${config.outputCsvPath}`);
  logger.info('────────────────────────────────────────────────────────────');

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    // 1) Load and validate input SKUs
    const skus = await loadSkus(inputJsonPath);
    logger.info(`Loaded ${skus.length} SKU(s) from skus.json`);

    // 2) Initialise CSV (fresh run)
    await initializeCsv(config.outputCsvPath);

    // 3) Launch Chromium browser
    browser = await chromium.launch({
      headless: config.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });

    // 4) Build site-specific scrape jobs
    const jobs = buildScrapeJobs(skus, browser);

    // 5) Execute with bounded concurrency
    const results = await processConcurrently(jobs, config.concurrentLimit);

    // Filter out any impossible null placeholders from failed worker catches
    const finalRows = results.filter((row): row is ProductData => row !== null);

    // 6) Append results to CSV
    await appendToCsv(config.outputCsvPath, finalRows);

    // 7) Emit summary
    const successCount = finalRows.filter((r) => r.Status === 'success').length;
    const errorCount = finalRows.filter((r) => r.Status === 'error').length;

    logger.info('────────────────────────────────────────────────────────────');
    logger.info('Scraping completed');
    logger.info(`Total input SKUs  : ${skus.length}`);
    logger.info(`Rows written      : ${finalRows.length}`);
    logger.info(`Success rows      : ${successCount}`);
    logger.info(`Error rows        : ${errorCount}`);
    logger.info('────────────────────────────────────────────────────────────');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Fatal error: ${msg}`);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close().catch((closeErr) => {
        logger.warn(`Browser close warning: ${String(closeErr)}`);
      });
    }
  }
};

// Execute directly when run via `node dist/scraper.js` or `ts-node src/scraper.ts`
if (require.main === module) {
  void main();
}
