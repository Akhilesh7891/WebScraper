/**
 * @fileoverview Unit tests for utility helpers.
 *
 * Covers:
 *  - `sanitizeString`
 *  - `randomInt`
 *  - `withRetry`
 *  - `processConcurrently`
 *
 * @author Akhilesh Chaurasia
 */

import {
  sanitizeString,
  randomInt,
  withRetry,
  processConcurrently,
} from '../utils';
import { RetryConfig } from '../types';

jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const retryConfig: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1,
  maxDelayMs: 5,
  backoffMultiplier: 2,
};

describe('utils.ts', () => {
  describe('sanitizeString', () => {
    it('returns N/A for nullish or empty values', () => {
      expect(sanitizeString(undefined)).toBe('N/A');
      expect(sanitizeString(null)).toBe('N/A');
      expect(sanitizeString('')).toBe('N/A');
    });

    it('normalizes whitespace and trims', () => {
      const input = '  Hello\n\t  World   from   Test  ';
      expect(sanitizeString(input)).toBe('Hello World from Test');
    });
  });

  describe('randomInt', () => {
    it('always returns values in the provided range', () => {
      for (let i = 0; i < 500; i++) {
        const value = randomInt(5, 10);
        expect(value).toBeGreaterThanOrEqual(5);
        expect(value).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('withRetry', () => {
    it('returns result on first successful execution', async () => {
      const fn = jest.fn(async () => 'ok');
      await expect(withRetry(fn, retryConfig, 'first-pass')).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries and eventually succeeds', async () => {
      let count = 0;
      const fn = jest.fn(async () => {
        count += 1;
        if (count < 3) throw new Error('transient');
        return 'done';
      });

      await expect(withRetry(fn, retryConfig, 'eventual-success')).resolves.toBe('done');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws after max retries', async () => {
      const fn = jest.fn(async () => {
        throw new Error('permanent-failure');
      });

      await expect(withRetry(fn, retryConfig, 'permanent')).rejects.toThrow('permanent-failure');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('processConcurrently', () => {
    it('preserves input task order in results', async () => {
      const tasks = [
        async () => 1,
        async () => 2,
        async () => 3,
        async () => 4,
      ];

      const results = await processConcurrently(tasks, 2);
      expect(results).toEqual([1, 2, 3, 4]);
    });

    it('returns empty array for no tasks', async () => {
      const results = await processConcurrently([], 3);
      expect(results).toEqual([]);
    });
  });
});
