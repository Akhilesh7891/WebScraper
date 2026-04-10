/**
 * @fileoverview Shared utility functions for the Web Scraper.
 *
 * Provides:
 *  - Timing helpers (`sleep`, `randomDelay`, `randomInt`)
 *  - User-agent rotation (`USER_AGENTS`, `getRandomUserAgent`)
 *  - Exponential-backoff retry (`withRetry`)
 *  - Bounded concurrency (`processConcurrently`)
 *  - String sanitisation (`sanitizeString`)
 *  - Timestamp helper (`getCurrentTimestamp`)
 *
 * All exported functions are individually unit-tested in
 * `src/__tests__/utils.test.ts`.
 *
 * @author  Akhilesh Chaurasia
 * @version 1.0.0
 * @since   2026-04-10
 */

import { RetryConfig } from './types';
import { logger } from './logger';

// ─── Timing Helpers ───────────────────────────────────────────────────────────

/**
 * Pauses execution for exactly `ms` milliseconds.
 *
 * @param ms - Duration in milliseconds.
 * @returns  A Promise that resolves after the delay.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns a cryptographically weak but statistically uniform random integer
 * in the closed interval [min, max].
 *
 * @param min - Inclusive lower bound.
 * @param max - Inclusive upper bound.
 */
export const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Pauses execution for a random duration within [minMs, maxMs].
 *
 * Used to introduce human-like timing variation between page interactions,
 * which reduces the risk of triggering rate-limiting heuristics.
 *
 * @param minMs - Minimum delay in milliseconds (default: 1 000).
 * @param maxMs - Maximum delay in milliseconds (default: 3 000).
 */
export const randomDelay = async (minMs = 1_000, maxMs = 3_000): Promise<void> => {
  const delay = randomInt(minMs, maxMs);
  logger.debug(`Introducing random delay of ${delay} ms`);
  await sleep(delay);
};

// ─── User-Agent Rotation ──────────────────────────────────────────────────────

/**
 * Pool of real-world browser User-Agent strings.
 *
 * Rotating the UA on each request helps avoid fingerprint-based bot detection.
 * Strings are kept up-to-date with common Chrome / Firefox / Safari releases.
 */
export const USER_AGENTS: readonly string[] = [
  // Chrome 132–135 on Windows 11
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  // Chrome 132–135 on macOS Sequoia / Sonoma
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  // Firefox 136–137 on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0',
  // Safari 18 on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_3_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3.1 Safari/605.1.15',
  // Edge 135 on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0',
] as const;

/**
 * Returns a randomly selected User-Agent string from the rotation pool.
 *
 * @returns A browser User-Agent header value.
 */
export const getRandomUserAgent = (): string =>
  USER_AGENTS[randomInt(0, USER_AGENTS.length - 1)];

// ─── Retry / Backoff ──────────────────────────────────────────────────────────

/**
 * Executes `fn` up to `config.maxRetries` times, using exponential backoff
 * between attempts.
 *
 * Back-off formula:
 *   delay_n = min(initialDelayMs × backoffMultiplier^(n-1), maxDelayMs)
 *
 * @template T     - The resolved value type of `fn`.
 * @param fn       - Async operation to execute.
 * @param config   - Retry configuration (attempts, delays, multiplier).
 * @param context  - Human-readable label used in log messages.
 * @returns        The value returned by `fn` on its first successful call.
 * @throws         The last error if all attempts are exhausted.
 *
 * @example
 * const html = await withRetry(
 *   () => page.goto(url, { timeout: 30_000 }),
 *   { maxRetries: 3, initialDelayMs: 2_000, maxDelayMs: 30_000, backoffMultiplier: 2 },
 *   `navigate to ${url}`,
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  context = 'operation',
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  let delay = config.initialDelayMs;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      logger.debug(`[retry] ${context} – attempt ${attempt}/${config.maxRetries}`);
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === config.maxRetries) {
        logger.error(
          `[retry] All ${config.maxRetries} attempts exhausted for "${context}": ${lastError.message}`,
        );
        throw lastError;
      }

      logger.warn(
        `[retry] Attempt ${attempt}/${config.maxRetries} failed for "${context}": ` +
          `${lastError.message}. Retrying in ${delay} ms…`,
      );

      await sleep(delay);
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
    }
  }

  throw lastError;
}

// ─── Bounded Concurrency ──────────────────────────────────────────────────────

/**
 * Executes an array of async task factories with a bounded concurrency limit.
 *
 * Implements a worker-pool pattern: `concurrentLimit` "worker" coroutines
 * continuously pull tasks from a shared index counter until none remain.
 * Because JavaScript is single-threaded, incrementing `currentIndex` is
 * atomic, so no additional synchronisation is needed.
 *
 * The result array preserves the original task ordering.
 *
 * @template T           - The resolved value type of each task.
 * @param tasks          - Array of zero-argument async task factories.
 * @param concurrentLimit - Maximum number of tasks executing simultaneously.
 * @returns              Results in the same order as `tasks`.
 *
 * @example
 * const results = await processConcurrently(skuTasks, 2);
 */
export async function processConcurrently<T>(
  tasks: Array<() => Promise<T>>,
  concurrentLimit: number,
): Promise<T[]> {
  if (tasks.length === 0) return [];

  const results: T[] = new Array(tasks.length);
  let currentIndex = 0;

  const worker = async (): Promise<void> => {
    while (currentIndex < tasks.length) {
      const index = currentIndex++;
      try {
        results[index] = await tasks[index]();
      } catch (err) {
        logger.error(`[concurrency] Task at index ${index} threw: ${err}`);
        // Store null-equivalent so the result array stays aligned
        results[index] = null as unknown as T;
      }
    }
  };

  const workerCount = Math.min(concurrentLimit, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

// ─── String Helpers ───────────────────────────────────────────────────────────

/**
 * Sanitises a raw string extracted from a web page for safe CSV storage.
 *
 * Operations performed (in order):
 *  1. Returns `'N/A'` for falsy values (null, undefined, empty string).
 *  2. Replaces CR, LF, and TAB characters with a single space.
 *  3. Collapses runs of whitespace to a single space.
 *  4. Trims leading and trailing whitespace.
 *
 * @param value - Raw input string (may be null or undefined).
 * @returns     Cleaned string, or `'N/A'` if the input was empty/nullish.
 */
export const sanitizeString = (value: string | null | undefined): string => {
  if (!value) return 'N/A';
  return value
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

// ─── Timestamp ────────────────────────────────────────────────────────────────

/**
 * Returns the current UTC date-time as an ISO 8601 string.
 *
 * Example output: `"2026-04-10T09:45:00.123Z"`
 */
export const getCurrentTimestamp = (): string => new Date().toISOString();
