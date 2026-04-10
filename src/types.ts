/**
 * @fileoverview TypeScript type definitions for the Web Scraper project.
 *
 * Centralises all shared interfaces and types used across the application,
 * ensuring strict typing and a single source of truth for data shapes.
 *
 * @author  Akhilesh Chaurasia
 * @version 1.0.0
 * @since   2026-04-10
 */

// ─── Enumerations ─────────────────────────────────────────────────────────────

/** Supported e-commerce source platforms. */
export type SourceType = 'Amazon' | 'Walmart';

/** Scrape result status. */
export type ScrapedStatus = 'success' | 'error';

// ─── Input Shapes ─────────────────────────────────────────────────────────────

/**
 * Represents a single product identifier entry from `skus.json`.
 *
 * @example
 * { "Type": "Amazon", "SKU": "B0CT4BB651" }
 */
export interface SKUEntry {
  /** Source platform – must be 'Amazon' or 'Walmart'. */
  Type: SourceType;
  /** Product identifier – Amazon ASIN or Walmart Item ID. */
  SKU: string;
}

/**
 * Schema for the `skus.json` input file.
 *
 * @example
 * { "skus": [{ "Type": "Amazon", "SKU": "B0CT4BB651" }] }
 */
export interface SKUsFile {
  skus: SKUEntry[];
}

// ─── Output Shapes ────────────────────────────────────────────────────────────

/**
 * Scraped product data that will be written to `product_data.csv`.
 * Fields are named to match the CSV header identifiers used by csv-writer.
 */
export interface ProductData {
  /** Product identifier (ASIN or Walmart Item ID). */
  SKU: string;
  /** Platform the product was scraped from. */
  Source: SourceType;
  /** Full product title. */
  Title: string;
  /** Product description or extracted bullet points (max 500 chars). */
  Description: string;
  /** Current listed price including currency symbol, e.g. "$29.99". */
  Price: string;
  /** Human-readable review count string, e.g. "1,234 ratings". */
  NumberOfReviews: string;
  /** Average customer rating string, e.g. "4.5 out of 5 stars". */
  Rating: string;
  /** ISO 8601 UTC timestamp of when the record was scraped. */
  ScrapedAt: string;
  /** Whether the scrape succeeded or encountered an error. */
  Status: ScrapedStatus;
}

// ─── Configuration Shapes ─────────────────────────────────────────────────────

/**
 * Configuration for the exponential-backoff retry mechanism.
 *
 * Each failed attempt waits `min(initialDelayMs * backoffMultiplier^n, maxDelayMs)`
 * before the next attempt.
 */
export interface RetryConfig {
  /** Total number of attempts (including the first). */
  maxRetries: number;
  /** Delay before the first retry (ms). */
  initialDelayMs: number;
  /** Upper bound on the retry delay (ms). */
  maxDelayMs: number;
  /** Multiplier applied to the delay after each failed attempt. */
  backoffMultiplier: number;
}

/**
 * Top-level scraper runtime configuration.
 * Passed into both the Amazon and Walmart scraper functions.
 */
export interface ScraperConfig {
  /** Whether Chromium runs headlessly (no visible UI). */
  headless: boolean;
  /** Playwright navigation timeout in milliseconds. */
  timeout: number;
  /** Retry/backoff settings for failed page fetches. */
  retryConfig: RetryConfig;
  /** Maximum number of browser contexts open simultaneously. */
  concurrentLimit: number;
  /** Absolute path to the output CSV file. */
  outputCsvPath: string;
  /** Absolute path to the error log file (used by Winston). */
  errorLogPath: string;
}
