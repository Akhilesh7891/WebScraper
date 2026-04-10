/**
 * @fileoverview Amazon product page scraper.
 *
 * Provides {@link scrapeAmazon} – the single public function that, given a
 * Playwright `Browser` instance and an ASIN, navigates to the Amazon product
 * detail page, extracts all required fields, and returns a {@link ProductData}
 * record.
 *
 * Anti-bot measures applied:
 *  - Isolated `BrowserContext` per request (fresh cookies / storage).
 *  - Random User-Agent string from a rotation pool.
 *  - Randomised viewport dimensions.
 *  - Realistic HTTP request headers (Accept, Accept-Language, Sec-Fetch-*).
 *  - `navigator.webdriver` override injected before any script executes.
 *  - Human-like random delays between navigation steps.
 *  - CAPTCHA detection with a single warm-up wait + reload.
 *
 * Each extraction helper tries multiple CSS selectors in priority order,
 * falling back gracefully to `'N/A'` when none match.
 *
 * @author  Akhilesh Chaurasia
 * @version 1.0.0
 * @since   2026-04-10
 */

import { Browser, BrowserContext, Page } from 'playwright';
import { ProductData, ScraperConfig } from './types';
import { logger } from './logger';
import {
  randomDelay,
  sanitizeString,
  getCurrentTimestamp,
  getRandomUserAgent,
  withRetry,
  randomInt,
} from './utils';

// ─── Constants ────────────────────────────────────────────────────────────────

const AMAZON_BASE_URL = 'https://www.amazon.com/dp';

/** Viewport pool – one is selected at random per request. */
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height:  768 },
  { width: 1440, height:  900 },
  { width: 1536, height:  864 },
] as const;

// ─── Detection Helpers ────────────────────────────────────────────────────────

/**
 * Returns `true` when the current page is a CAPTCHA / robot-check challenge.
 *
 * Checks the page title, URL, and the presence of the CAPTCHA form element.
 */
const isCaptchaPage = async (page: Page): Promise<boolean> => {
  const [title, url] = [await page.title(), page.url()];
  return (
    title.toLowerCase().includes('robot check') ||
    title.toLowerCase().includes('captcha') ||
    url.includes('/errors/validateCaptcha') ||
    (await page.$('form[action="/errors/validateCaptcha"]')) !== null
  );
};

/**
 * Returns `true` when the product is unavailable (404, search-redirect,
 * or the critical title element is missing entirely).
 */
const isProductNotFound = async (page: Page): Promise<boolean> => {
  const [url, title] = [page.url(), await page.title()];
  if (url.includes('/404') || title.toLowerCase().includes('page not found')) {
    return true;
  }
  // If neither canonical title selector resolves, treat as "not found"
  const hasTitle =
    (await page.$('#productTitle')) !== null ||
    (await page.$('h1.a-size-large')) !== null;
  return !hasTitle;
};

// ─── Stealth Injection ────────────────────────────────────────────────────────

/**
 * Injects JavaScript overrides before any page script executes.
 *
 * Overrides `navigator.webdriver`, `navigator.plugins`, and
 * `navigator.languages` to mask Playwright's automation footprint.
 */
const injectStealthScripts = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    /* eslint-disable */
    // These statements execute in the browser context – navigator is defined there.
    // @ts-ignore
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // @ts-ignore
    Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] });
    // @ts-ignore
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    /* eslint-enable */
  });
};

// ─── Field Extractors ─────────────────────────────────────────────────────────

/**
 * Extracts the product title.
 *
 * Selector priority:
 *  1. `#productTitle`           – standard detail page
 *  2. `h1.a-size-large`         – alternate layout
 *  3. `span#productTitle`       – redundant but harmless
 */
const extractTitle = async (page: Page): Promise<string> => {
  const selectors = [
    '#productTitle',
    'h1.a-size-large',
    'span#productTitle',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        if (text) return sanitizeString(text);
      }
    } catch { /* try next selector */ }
  }
  return 'N/A';
};

/**
 * Extracts the current listed price.
 *
 * Amazon renders price in several layouts depending on deal type, Prime
 * eligibility, etc.  Selectors are tried in descending specificity.
 */
const extractPrice = async (page: Page): Promise<string> => {
  const selectors = [
    '#corePriceDisplay_desktop_feature_div .a-offscreen',
    '.priceToPay .a-offscreen',
    '.apexPriceToPay .a-offscreen',
    '.a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '#price_inside_buybox',
    '#newBuyBoxPrice',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        if (text?.trim()) return sanitizeString(text);
      }
    } catch { /* try next selector */ }
  }
  return 'N/A';
};

/**
 * Extracts the product description.
 *
 * Prefers the structured feature bullet list (up to 5 points joined with
 * ` | `).  Falls back to the prose `#productDescription` section.
 * Long descriptions are truncated to 500 characters.
 */
const extractDescription = async (page: Page): Promise<string> => {
  // ── Bullet points (preferred) ─────────────────────────────────────────────
  try {
    const bullets = await page.$$('#feature-bullets .a-list-item');
    if (bullets.length > 0) {
      const texts: string[] = [];
      for (const b of bullets.slice(0, 5)) {
        const t = await b.textContent();
        if (t?.trim()) texts.push(sanitizeString(t));
      }
      if (texts.length > 0) return texts.join(' | ');
    }
  } catch { /* fall through */ }

  // ── Prose description (fallback) ──────────────────────────────────────────
  const descSelectors = [
    '#productDescription p',
    '#productDescription',
    '#aplus-feature-div p',
    '#bookDescription_feature_div p',
  ];
  for (const sel of descSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        if (text?.trim()) {
          const clean = sanitizeString(text);
          return clean.length > 500 ? `${clean.slice(0, 500)}…` : clean;
        }
      }
    } catch { /* try next selector */ }
  }
  return 'N/A';
};

/**
 * Extracts the total review count (e.g. "3,421 ratings").
 */
const extractReviewCount = async (page: Page): Promise<string> => {
  const selectors = [
    '#acrCustomerReviewText',
    'span[data-hook="total-review-count"]',
    '.totalReviewCount',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        if (text?.trim()) return sanitizeString(text);
      }
    } catch { /* try next selector */ }
  }
  return 'N/A';
};

/**
 * Extracts the average customer rating (e.g. "4.5 out of 5 stars").
 */
const extractRating = async (page: Page): Promise<string> => {
  const selectors = [
    'span[data-hook="rating-out-of-text"]',
    '#acrPopover .a-icon-alt',
    'i[data-hook="average-star-rating"] span.a-icon-alt',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text =
          (await el.textContent()) ?? (await el.getAttribute('aria-label'));
        if (text?.trim()) return sanitizeString(text);
      }
    } catch { /* try next selector */ }
  }
  return 'N/A';
};

// ─── Public Scrape Function ───────────────────────────────────────────────────

/**
 * Scrapes product data for a single Amazon ASIN.
 *
 * Flow:
 *  1. Opens an isolated `BrowserContext` with a random UA + viewport.
 *  2. Injects stealth scripts.
 *  3. Navigates to `https://www.amazon.com/dp/{sku}` with retry logic.
 *  4. Detects and handles CAPTCHA pages.
 *  5. Validates that the product exists.
 *  6. Extracts title, price, description, review count, and rating in parallel.
 *  7. Returns a structured `ProductData` record.
 *
 * On any unrecoverable error, returns a `ProductData` record with
 * `Status: 'error'` and `'N/A'` for all data fields so that the CSV row is
 * still written (traceable via the `errors.log`).
 *
 * @param browser - A live Playwright `Browser` instance.
 * @param sku     - Amazon ASIN (e.g. `'B0CT4BB651'`).
 * @param config  - Runtime scraper configuration.
 * @returns       A fully-populated (or error-marked) `ProductData` record.
 */
export const scrapeAmazon = async (
  browser: Browser,
  sku: string,
  config: ScraperConfig,
): Promise<ProductData> => {
  const url = `${AMAZON_BASE_URL}/${sku}`;
  const viewport = VIEWPORTS[randomInt(0, VIEWPORTS.length - 1)];

  logger.info(`[Amazon] Scraping SKU: ${sku}  →  ${url}`);

  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    // ── 1. Create isolated browser context ──────────────────────────────────
    context = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language':    'en-US,en;q=0.9',
        'Accept-Encoding':    'gzip, deflate, br',
        Connection:           'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest':     'document',
        'Sec-Fetch-Mode':     'navigate',
        'Sec-Fetch-Site':     'none',
        'Sec-Fetch-User':     '?1',
      },
    });

    page = await context.newPage();
    await injectStealthScripts(page);

    // ── 2. Navigate with retry ───────────────────────────────────────────────
    await withRetry(
      async () => {
        await page!.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: config.timeout,
        });
        await randomDelay(1_500, 3_500);
      },
      config.retryConfig,
      `Amazon navigation for ASIN ${sku}`,
    );

    // ── 3. CAPTCHA handling ──────────────────────────────────────────────────
    if (await isCaptchaPage(page)) {
      logger.warn(`[Amazon] CAPTCHA detected for SKU ${sku} – pausing then reloading…`);
      await randomDelay(5_000, 10_000);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: config.timeout });
      await randomDelay(2_000, 4_000);

      if (await isCaptchaPage(page)) {
        throw new Error(`CAPTCHA could not be bypassed for Amazon SKU: ${sku}`);
      }
    }

    // ── 4. Product existence check ───────────────────────────────────────────
    if (await isProductNotFound(page)) {
      throw new Error(`Product not found on Amazon for SKU: ${sku}`);
    }

    // ── 5. Wait for title element ────────────────────────────────────────────
    try {
      await page.waitForSelector('#productTitle, h1.a-size-large', {
        timeout: 10_000,
        state:   'visible',
      });
    } catch {
      logger.warn(`[Amazon] Title selector not visible for SKU ${sku} – proceeding anyway`);
    }

    // ── 6. Extract fields concurrently ───────────────────────────────────────
    const [title, price, description, numberOfReviews, rating] = await Promise.all([
      extractTitle(page),
      extractPrice(page),
      extractDescription(page),
      extractReviewCount(page),
      extractRating(page),
    ]);

    logger.info(`[Amazon]  SKU: ${sku}  |  "${title.slice(0, 60)}…"`);

    return {
      SKU:            sku,
      Source:         'Amazon',
      Title:          title,
      Description:    description,
      Price:          price,
      NumberOfReviews: numberOfReviews,
      Rating:         rating,
      ScrapedAt:      getCurrentTimestamp(),
      Status:         'success',
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[Amazon]  SKU: ${sku}  |  ${msg}`);

    return {
      SKU:            sku,
      Source:         'Amazon',
      Title:          'N/A',
      Description:    'N/A',
      Price:          'N/A',
      NumberOfReviews: 'N/A',
      Rating:         'N/A',
      ScrapedAt:      getCurrentTimestamp(),
      Status:         'error',
    };
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
  }
};
