/**
 * @fileoverview CSV I/O operations for the Web Scraper output.
 *
 * Wraps the `csv-writer` library to provide two high-level operations:
 *  - {@link initializeCsv}  – creates (or overwrites) the CSV file with
 *                             the header row and no data rows.
 *  - {@link appendToCsv}    – appends one or more product records to an
 *                             existing CSV file (no duplicate headers).
 *
 * Column order matches the assessment specification:
 *   SKU | Source | Title | Description | Price |
 *   Number of Reviews | Rating | Scraped At (UTC) | Status
 *
 * @author  Akhilesh Chaurasia
 * @version 1.0.0
 * @since   2026-04-10
 */

import { createObjectCsvWriter } from 'csv-writer';
import * as path from 'path';
import { ProductData } from './types';
import { logger } from './logger';

// ─── Column Definitions ───────────────────────────────────────────────────────

/**
 * Ordered CSV column definitions.
 *
 * `id`    – matches the key name in `ProductData`.
 * `title` – the human-readable header written to the CSV file.
 */
const CSV_HEADERS: Array<{ id: keyof ProductData; title: string }> = [
  { id: 'SKU',           title: 'SKU'                },
  { id: 'Source',        title: 'Source'             },
  { id: 'Title',         title: 'Title'              },
  { id: 'Description',   title: 'Description'        },
  { id: 'Price',         title: 'Price'              },
  { id: 'NumberOfReviews', title: 'Number of Reviews' },
  { id: 'Rating',        title: 'Rating'             },
  { id: 'ScrapedAt',     title: 'Scraped At (UTC)'   },
  { id: 'Status',        title: 'Status'             },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialises the output CSV file, writing only the header row.
 *
 * If the file already exists it is **overwritten** (fresh run semantics).
 * Call this once at application start-up before any records are appended.
 *
 * @param outputPath - Absolute path to the target CSV file.
 *
 * @example
 * await initializeCsv(path.resolve(process.cwd(), 'product_data.csv'));
 */
export const initializeCsv = async (outputPath: string): Promise<void> => {
  const writer = createObjectCsvWriter({
    path: outputPath,
    header: CSV_HEADERS as Array<{ id: string; title: string }>,
    // append: false (default) → create/overwrite, write header
  });

  await writer.writeRecords([]); // header only, no data rows
  logger.info(`CSV initialised → ${path.basename(outputPath)}`);
};

/**
 * Appends an array of {@link ProductData} records to an existing CSV file.
 *
 * The file **must** have been initialised with {@link initializeCsv} first
 * so that the header row is already present.  This function writes data rows
 * only (no additional header row).
 *
 * Silently returns when `records` is empty.
 *
 * @param outputPath - Absolute path to the target CSV file.
 * @param records    - Product records to append.
 *
 * @example
 * await appendToCsv(csvPath, [
 *   { SKU: 'B0CT4BB651', Source: 'Amazon', Title: 'Widget', … },
 * ]);
 */
export const appendToCsv = async (
  outputPath: string,
  records: ProductData[],
): Promise<void> => {
  if (records.length === 0) {
    logger.debug('appendToCsv: no records to write, skipping.');
    return;
  }

  const writer = createObjectCsvWriter({
    path: outputPath,
    header: CSV_HEADERS as Array<{ id: string; title: string }>,
    append: true, // data-only rows; preserves existing header
  });

  await writer.writeRecords(records);
  logger.info(
    `Appended ${records.length} record(s) → ${path.basename(outputPath)}`,
  );
};
