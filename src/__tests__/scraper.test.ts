/**
 * @fileoverview Unit tests for `loadSkus` validation logic in scraper.ts.
 *
 * @author Akhilesh Chaurasia
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { loadSkus } from '../scraper';

describe('scraper.ts - loadSkus', () => {
  const tempDir = path.join(os.tmpdir(), `web-scraper-tests-${Date.now()}`);

  beforeAll(async () => {
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('loads valid schema successfully', async () => {
    const filePath = path.join(tempDir, 'valid.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        skus: [
          { Type: 'Amazon', SKU: 'B0CT4BB651' },
          { Type: 'Walmart', SKU: '5326288985' },
        ],
      }),
      'utf8',
    );

    const entries = await loadSkus(filePath);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ Type: 'Amazon', SKU: 'B0CT4BB651' });
  });

  it('throws on missing skus array', async () => {
    const filePath = path.join(tempDir, 'invalid-missing-skus.json');
    await fs.writeFile(filePath, JSON.stringify({ wrong: [] }), 'utf8');

    await expect(loadSkus(filePath)).rejects.toThrow('Invalid schema');
  });

  it('throws on invalid source Type', async () => {
    const filePath = path.join(tempDir, 'invalid-type.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        skus: [{ Type: 'Ebay', SKU: '123' }],
      }),
      'utf8',
    );

    await expect(loadSkus(filePath)).rejects.toThrow('Invalid Type');
  });

  it('throws on empty SKU value', async () => {
    const filePath = path.join(tempDir, 'invalid-sku.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        skus: [{ Type: 'Amazon', SKU: '' }],
      }),
      'utf8',
    );

    await expect(loadSkus(filePath)).rejects.toThrow('Invalid SKU');
  });
});
