# Web Scraper Assessment (TypeScript + Playwright)

A production-ready web scraper implementation for extracting product data from **Amazon** and **Walmart** based on SKU input.

---

## Author

**Akhilesh Chaurasia**  
Email: akhilesh7891@gmail.com

---

## Objective

This project fulfills the assessment requirements to:

- Read SKUs from `skus.json`
- Scrape product details from Amazon/Walmart
- Extract:
  - Price
  - Title
  - Description
  - Number of Reviews
  - Rating
- Save records to `product_data.csv`
- Log failures into `errors.log`

---

## Tech Stack

- **Node.js** (>= 18)
- **TypeScript**
- **Playwright** (Chromium)
- **csv-writer**
- **Winston** (structured logging)
- **Jest + ts-jest** (unit tests)

---

## Project Structure

```text
/project-root
|-- /src
|   |-- amazonScraper.ts
|   |-- walmartScraper.ts
|   |-- scraper.ts
|   |-- csvWriter.ts
|   |-- utils.ts
|   |-- logger.ts
|   |-- types.ts
|   |-- /__tests__
|       |-- utils.test.ts
|       |-- scraper.test.ts
|-- skus.json
|-- package.json
|-- tsconfig.json
|-- jest.config.js
|-- product_data.csv
|-- errors.log
|-- README.md
```

---

## Setup & Installation

1. Use Node.js 20 (recommended):

```bash
nvm use
```

> This project includes `.nvmrc` (`20`). If Node 20 is not installed yet:
>
> ```bash
> nvm install 20
> nvm use 20
> ```

2. Install dependencies:

```bash
npm install --ignore-scripts
```

3. Install Playwright Chromium browser:

```bash
npx playwright install chromium
```

> If your Linux system needs extra native packages **and you have sudo access**, run:
>
> ```bash
> npx playwright install --with-deps chromium
> ```
>
> If you do not have sudo access, use `npx playwright install chromium` only.

---

## Input Format (`skus.json`)

```json
{
  "skus": [
    { "Type": "Amazon", "SKU": "B0CT4BB651" },
    { "Type": "Walmart", "SKU": "5326288985" },
    { "Type": "Amazon", "SKU": "B01LR5S6HK" }
  ]
}
```

Validation rules:

- `Type` must be exactly `Amazon` or `Walmart`
- `SKU` must be a non-empty string

---

## Running the Scraper

### Development mode

```bash
npm run dev
```

### Build + run production mode

```bash
npm run build
npm start
```

### Run with Docker

Build image:

```bash
docker build -t web-scraper-assessment:latest .
```

Run container:

```bash
docker run --rm \
  -e HEADLESS=true \
  -e CONCURRENCY=2 \
  -v "$(pwd)/product_data.csv:/app/product_data.csv" \
  -v "$(pwd)/errors.log:/app/errors.log" \
  web-scraper-assessment:latest
```

Notes:

- The Docker image is based on Playwright's official Ubuntu image with browser dependencies preinstalled.
- Input is read from `/app/skus.json` bundled in the image.
- Output files are persisted to the host through volume mounts.

---

## Environment Variables

Optional runtime overrides:

- `HEADLESS=true|false` (default: `true`)
- `TIMEOUT_MS=<number>` (default: `45000`)
- `CONCURRENCY=<number>` (default: `2`)
- `LOG_LEVEL=error|warn|info|debug` (default: `info`)

Example:

```bash
HEADLESS=false CONCURRENCY=3 LOG_LEVEL=debug npm run dev
```

---

## Output Files

### `product_data.csv`

Columns:

- SKU
- Source
- Title
- Description
- Price
- Number of Reviews
- Rating
- Scraped At (UTC)
- Status

A row is always generated per input SKU.
If scraping fails, data fields are written as `N/A` and `Status=error`.

### `errors.log`

Contains all scraper failures and critical runtime errors with timestamps.

---

## Professional Engineering Features Included

### 1) Modular architecture

- Site-independent orchestration in `scraper.ts`
- Site-specific extraction logic split into dedicated modules:
  - `amazonScraper.ts`
  - `walmartScraper.ts`

### 2) Strong typing

- Shared type contracts in `types.ts`
- Explicit interfaces for input/output and configuration

### 3) Retry with exponential backoff

For transient failures, retries use:

- max retries = 3
- initial delay = 2000ms
- multiplier = 2
- max delay = 20000ms

### 4) Concurrency management

- Bounded worker-pool execution
- Configurable via `CONCURRENCY`
- Preserves input-to-output order

### 5) Anti-bot hardening (best-effort)

- Random User-Agent rotation
- Random viewport selection
- Browser context isolation per SKU
- Human-like random delays
- `navigator.webdriver` masking
- CAPTCHA / bot-block detection + reload attempt

### 6) Graceful failure model

- No hard crash on single SKU failure
- Error rows still written to CSV
- Details captured in logs

### 7) Automated tests

- Utility function tests (`utils.test.ts`)
- JSON schema validation tests (`scraper.test.ts`)

Run tests:

```bash
npm test
```

### 8) CI/CD automation (GitHub Actions)

A production CI workflow is included at:

- `.github/workflows/ci.yml`

Pipeline jobs:

1. **build-and-test**
  - Uses Node.js 20
  - Installs dependencies with `npm ci --ignore-scripts`
  - Runs TypeScript build (`npm run build`)
  - Runs tests (`npm test -- --runInBand`)
  - Uploads coverage artifact
2. **docker-build**
  - Builds Docker image to validate container build integrity

---

## Assumptions

1. Input SKUs are valid platform-specific identifiers:
   - Amazon: ASIN
   - Walmart: Item ID
2. Target pages are publicly reachable from the execution environment.
3. Product detail pages contain at least one known selector among configured fallbacks.
4. The system running scraper has internet access and permits Playwright browser execution.

---

## Limitations

1. **Selector volatility**: Amazon/Walmart frequently update DOM structure. Selectors may require maintenance.
2. **Anti-bot controls**: Aggressive CAPTCHA / bot mitigation cannot be fully bypassed programmatically.
3. **Geo/localization differences**: Some fields differ by region, currency, and account state.
4. **Dynamic availability**: Out-of-stock and variant-only listings may omit price/review fields.
5. **No proxy pool included**: Enterprise proxy rotation is not included by default.

---

## Recommended Future Enhancements

- Add proxy rotation + residential IP strategy
- Add screenshot capture on failure (`artifacts/`)
- Add OpenTelemetry traces and metrics
- Add integration tests with mocked HTML fixtures
- Add job checkpoint/resume for large input batches

---

## Assessment Criteria Mapping

- **Code Quality**: Strong typing, modular design, clean separation of concerns
- **Functionality**: End-to-end extraction and CSV persistence implemented
- **Error Handling**: Structured logging + per-SKU graceful fallback rows
- **Documentation**: This README includes setup, usage, assumptions, and limits
- **Bonus**:
  - Retries
  - Concurrency
  - Unit tests

---

## Notes on Responsible Usage

This implementation is for educational/assessment use. Always ensure compliance with each website’s Terms of Service, robots policies, and applicable legal requirements before running at scale.
