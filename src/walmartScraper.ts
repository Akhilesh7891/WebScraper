/**
 * @fileoverview Walmart product page scraper.
 *
 * Provides {@link scrapeWalmart} – the single public function that, given a
 * Playwright `Browser` instance and a Walmart Item ID, navigates to the
 * product detail page, extracts all required fields, and returns a
 * {@link ProductData} record.
 *
 * Walmart's front-end is a React SPA that lazy-loads many sections.  This
 * scraper waits for `domcontentloaded` then explicitly waits for the product
 * title selector before extracting data.
 *
 * Anti-bot measures applied:
 *  - Isolated `BrowserContext` per request.
 *  - Random User-Agent from the shared rotation pool.
 *  - Randomised viewport dimensions.
 *  - Realistic HTTP request headers.
 *  - `navigator.webdriver` override injected before page scripts run.
 *  - Human-like random delays.
 *  - Bot-block detection with wait + reload.
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

const WALMART_BASE_URL = 'https://www.walmart.com/ip';

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height:  768 },
  { width: 1440, height:  900 },
  { width: 1536, height:  864 },
] as const;

// ─── Detection Helpers ────────────────────────────────────────────────────────

/**
 * Returns `true` when Walmart's bot-protection system has blocked the request.
 * Detectable via page title, URL path, or the presence of a CAPTCHA element.
 */
const isBotBlocked = async (page: Page): Promise<boolean> => {
  const [title, url] = [await page.title(), page.url()];
  return (
    title.toLowerCase().includes('blocked') ||
    title.toLowerCase().includes('captcha') ||
    url.toLowerCase().includes('blocked') ||
    (await page.$('.captcha-container')) !== null ||
    (await page.$('[data-automation-id="captcha"]')) !== null
  );
};

/**
 * Returns `true` when the product is unavailable or the page redirected to a
 * search / 404 page.
 */
const isProductNotFound = async (page: Page): Promise<boolean> => {
  const url = page.url();
  // Redirect to /search means item was not found
  if (url.includes('/search') || url.includes('404')) return true;

  const hasTitle =
    (await page.$('[itemprop="name"]'))                           !== null ||
    (await page.$('h1[data-automation-id="product-title"]'))      !== null ||
    (await page.$('h1.prod-ProductTitle'))                        !== null;

  return !hasTitle;
};

// ─── Stealth Injection ────────────────────────────────────────────────────────

/**
 * Injects JavaScript overrides before any page script executes.
 * Masks Playwright's automation fingerprint across several detection vectors:
 *  - `navigator.webdriver` set to undefined
 *  - `navigator.plugins` populated with realistic entries
 *  - `navigator.languages` set to en-US
 *  - `window.chrome` faked with runtime/loadTimes/csi/app stubs
 *  - `navigator.permissions.query` reports 'granted' instead of 'denied'
 *  - `navigator.connection` spoofed as a 4G connection
 *  - `Notification.permission` reports 'default'
 */
const injectStealthScripts = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    /* eslint-disable */
    // ── webdriver flag ──────────────────────────────────────────────────────
    // @ts-ignore
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // ── plugins ─────────────────────────────────────────────────────────────
    const pluginData = [
      { name: 'PDF Viewer',         filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer',  filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chromium PDF Viewer',filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    ];
    // @ts-ignore
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr: any[] = pluginData.map((p) => {
          const plugin: any = { name: p.name, filename: p.filename, description: p.description, length: 0 };
          plugin[Symbol.iterator] = Array.prototype[Symbol.iterator];
          return plugin;
        });
        (arr as any).refresh = () => {};
        (arr as any).item     = (i: number) => arr[i];
        (arr as any).namedItem = (n: string) => arr.find((p: any) => p.name === n) ?? null;
        Object.defineProperty(arr, 'length', { get: () => pluginData.length });
        return arr;
      },
    });

    // ── languages ───────────────────────────────────────────────────────────
    // @ts-ignore
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

    // ── window.chrome ────────────────────────────────────────────────────────
    // @ts-ignore
    if (!window.chrome) {
      // @ts-ignore
      window.chrome = {
        app: {
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          getDetails:     () => null,
          getIsInstalled: () => false,
          installState:   () => 'not_installed',
          isInstalled: false,
          runningState: () => 'cannot_run',
        },
        // @ts-ignore
        runtime: { PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' } },
        loadTimes: () => ({
          requestTime: performance.now() / 1000 - Math.random() * 2,
          startLoadTime: performance.now() / 1000 - Math.random(),
          commitLoadTime: performance.now() / 1000 - Math.random() * 0.5,
          finishDocumentLoadTime: performance.now() / 1000,
          finishLoadTime: performance.now() / 1000,
          firstPaintTime: performance.now() / 1000,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        }),
        csi: () => ({
          startE: Date.now() - Math.floor(Math.random() * 2000),
          onloadT: Date.now() - Math.floor(Math.random() * 1000),
          pageT: Math.random() * 2000,
          tran: Math.floor(Math.random() * 20),
        }),
      };
    }

    // ── permissions ──────────────────────────────────────────────────────────
    // @ts-ignore
    const origQuery = (navigator as any).permissions.query.bind((navigator as any).permissions);
    // @ts-ignore
    (navigator as any).permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? // @ts-ignore
          Promise.resolve({ state: (Notification as any).permission, onchange: null })
        : origQuery(parameters);

    // ── connection ───────────────────────────────────────────────────────────
    // @ts-ignore
    if (!navigator.connection) {
      // @ts-ignore
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          rtt: 100,
          type: 'cellular',
          saveData: false,
          downlink: 10.0,
          downlinkMax: Infinity,
          effectiveType: '4g',
          onchange: null,
        }),
      });
    }

    // ── Notification.permission ──────────────────────────────────────────────
    try {
      // @ts-ignore
      if (Notification.permission === 'denied') {
        // @ts-ignore
        Object.defineProperty(Notification, 'permission', { get: () => 'default' });
      }
    } catch { /* ignore */ }
    /* eslint-enable */
  });
};

// ─── Field Extractors ─────────────────────────────────────────────────────────

/**
 * Extracts the product title from a Walmart product page.
 *
 * Walmart migrates between multiple React component versions;  selectors are
 * ordered from newest → oldest deployment.
 */
const extractTitle = async (page: Page): Promise<string> => {
  const selectors = [
    'h1[itemprop="name"]',
    '[itemprop="name"]',
    'h1[data-automation-id="product-title"]',
    'h1.prod-ProductTitle',
    'h1.f3.b.lh-title',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        if (text) return sanitizeString(text);
      }
    } catch { /* try next */ }
  }
  return 'N/A';
};

/**
 * Extracts the listed price from a Walmart product page.
 *
 * Handles both the `[itemprop="price"]` microdata attribute (`content`)
 * and visible price text nodes.  Prepends `$` when the value is numeric only.
 */
const extractPrice = async (page: Page): Promise<string> => {
  const selectors = [
    '[itemprop="price"]',
    'span[data-automation-id="buybox-price"]',
    '[data-automation-id="product-price"] .price-characteristic',
    '.price-characteristic',
    '.prod-PriceSection .price-group',
    '[data-testid="price-wrap"] .f2',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        // Microdata `content` attribute holds the clean numeric value
        const content = await el.getAttribute('content');
        if (content?.trim()) {
          return content.trim().startsWith('$') ? content.trim() : `$${content.trim()}`;
        }
        const text = await el.textContent();
        if (text?.trim()) return sanitizeString(text);
      }
    } catch { /* try next */ }
  }
  return 'N/A';
};

/**
 * Extracts the product description from a Walmart product page.
 *
 * Prefers the long-form description block; falls back to feature-list bullets.
 * Descriptions exceeding 500 characters are truncated.
 */
const extractDescription = async (page: Page): Promise<string> => {
  // ── Long-form description ─────────────────────────────────────────────────
  const descSelectors = [
    '[data-automation-id="product-description-content"] p',
    '.about-desc',
    '#item-description-content p',
    '.product-short-description',
    '[data-testid="product-description"] p',
    '.wl-about-this-item p',
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
    } catch { /* try next */ }
  }

  // ── Feature / key-spec bullets (fallback) ────────────────────────────────
  try {
    const items = await page.$$('[data-automation-id="product-feature-list"] li');
    if (items.length > 0) {
      const texts: string[] = [];
      for (const item of items.slice(0, 5)) {
        const t = await item.textContent();
        if (t?.trim()) texts.push(sanitizeString(t));
      }
      if (texts.length > 0) return texts.join(' | ');
    }
  } catch { /* fall through */ }

  return 'N/A';
};

/**
 * Extracts the total review count from a Walmart product page.
 */
const extractReviewCount = async (page: Page): Promise<string> => {
  const selectors = [
    '.stars-reviews-count',
    'span.stars-reviews-count',
    '[data-automation-id="reviews-and-ratings-summary"] .review-summary',
    'a[data-tl-id="ProductPage_ReviewCount"]',
    '[itemprop="reviewCount"]',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        if (text?.trim()) return sanitizeString(text);
      }
    } catch { /* try next */ }
  }
  return 'N/A';
};

/**
 * Extracts the average customer rating from a Walmart product page.
 */
const extractRating = async (page: Page): Promise<string> => {
  const selectors = [
    '[itemprop="ratingValue"]',
    '.stars-container .b',
    '[data-automation-id="product-stars"] span',
    '.rating-number',
    '[data-testid="reviews-and-ratings"] .f6.b',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text =
          (await el.getAttribute('content')) ??
          (await el.textContent());
        if (text?.trim()) return sanitizeString(text);
      }
    } catch { /* try next */ }
  }
  return 'N/A';
};

// ─── Public Scrape Function ───────────────────────────────────────────────────

/**
 * Scrapes product data for a single Walmart Item ID.
 *
 * Flow:
 *  1. Opens an isolated `BrowserContext` with random UA + viewport.
 *  2. Injects comprehensive stealth scripts.
 *  3. Navigates to `https://www.walmart.com` (homepage) then to the product
 *     URL, establishing a natural referrer chain and session cookies.
 *  4. Detects and handles bot-block pages (up to 3 recovery cycles with
 *     exponential back-off).
 *  5. Validates that the product exists.
 *  6. Waits for the title element to become visible.
 *  7. Extracts title, price, description, review count, and rating in parallel.
 *  8. Returns a structured `ProductData` record.
 *
 * On any unrecoverable error, returns a `ProductData` record with
 * `Status: 'error'` and `'N/A'` for all data fields.
 *
 * @param browser - A live Playwright `Browser` instance.
 * @param sku     - Walmart Item ID (e.g. `'5326288985'`).
 * @param config  - Runtime scraper configuration.
 * @returns       A fully-populated (or error-marked) `ProductData` record.
 */
export const scrapeWalmart = async (
  browser: Browser,
  sku: string,
  config: ScraperConfig,
): Promise<ProductData> => {
  const url = `${WALMART_BASE_URL}/${sku}`;
  const viewport = VIEWPORTS[randomInt(0, VIEWPORTS.length - 1)];

  logger.info(`[Walmart] ▶ Scraping SKU: ${sku}  →  ${url}`);

  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    // ── 1. Create isolated browser context ──────────────────────────────────
    context = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport,
      locale: 'en-US',
      timezoneId: 'America/Chicago',
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

    // ── 2. Two-step navigation: homepage → product ───────────────────────────
    // Navigating directly to a product URL is flagged by Walmart's TLS/
    // behavioural fingerprinting.  Landing on the homepage first establishes
    // natural referrer chain and session cookies before hitting the product.
    await withRetry(
      async () => {
        await page!.goto('https://www.walmart.com', {
          waitUntil: 'domcontentloaded',
          timeout: config.timeout,
        });
        await randomDelay(2_000, 4_000);
        // Light mouse movement to simulate a human landing on the page
        await page!.mouse.move(
          randomInt(200, 800),
          randomInt(200, 600),
        );
        await randomDelay(1_000, 2_500);
        await page!.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: config.timeout,
        });
        await randomDelay(2_000, 4_000);
      },
      config.retryConfig,
      `Walmart navigation for SKU ${sku}`,
    );

    // ── 3. Bot-block handling (up to 3 recovery cycles) ──────────────────────
    const MAX_BOT_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_BOT_RETRIES; attempt++) {
      if (!(await isBotBlocked(page))) break;

      if (attempt === MAX_BOT_RETRIES) {
        throw new Error(`Bot protection could not be bypassed for Walmart SKU: ${sku}`);
      }

      logger.warn(
        `[Walmart] Bot block detected for SKU ${sku} – attempt ${attempt}/${MAX_BOT_RETRIES - 1}, waiting and reloading…`,
      );
      // Exponential back-off: 8–15s, 15–25s
      await randomDelay(8_000 * attempt, 15_000 * attempt);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: config.timeout });
      await randomDelay(3_000, 6_000);
    }

    // ── 4. Product existence check ─────────────────────────────────────────────
    if (await isProductNotFound(page)) {
      throw new Error(`Product not found on Walmart for SKU: ${sku}`);
    }

    // ── 5. Wait for title ──────────────────────────────────────────────────────
    try {
      await page.waitForSelector(
        '[itemprop="name"], h1[data-automation-id="product-title"], h1.prod-ProductTitle',
        { timeout: 12_000, state: 'visible' },
      );
    } catch {
      logger.warn(`[Walmart] Title not visible within timeout for SKU ${sku} – proceeding`);
    }

    // ── 6. Extract fields concurrently ─────────────────────────────────────────
    const [title, price, description, numberOfReviews, rating] = await Promise.all([
      extractTitle(page),
      extractPrice(page),
      extractDescription(page),
      extractReviewCount(page),
      extractRating(page),
    ]);

    logger.info(`[Walmart] ✔ SKU: ${sku}  |  "${title.slice(0, 60)}…"`);

    return {
      SKU:             sku,
      Source:          'Walmart',
      Title:           title,
      Description:     description,
      Price:           price,
      NumberOfReviews: numberOfReviews,
      Rating:          rating,
      ScrapedAt:       getCurrentTimestamp(),
      Status:          'success',
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[Walmart] ✘ SKU: ${sku}  |  ${msg}`);

    return {
      SKU:             sku,
      Source:          'Walmart',
      Title:           'N/A',
      Description:     'N/A',
      Price:           'N/A',
      NumberOfReviews: 'N/A',
      Rating:          'N/A',
      ScrapedAt:       getCurrentTimestamp(),
      Status:          'error',
    };
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
  }
};
