/**
 * @fileoverview Application-wide logging configuration.
 *
 * Provides a singleton Winston logger that writes to:
 *  - **stdout** (colourised, human-readable)
 *  - **errors.log** (error-level only, for the assessment deliverable)
 *  - **scraper.log** (all levels, full session history)
 *
 * Usage:
 * ```ts
 * import { logger } from './logger';
 * logger.info('Browser launched');
 * logger.error('Scrape failed', { stack: err.stack });
 * ```
 *
 * @author  Akhilesh Chaurasia
 * @version 1.0.0
 * @since   2026-04-10
 */

import * as winston from 'winston';
import * as path from 'path';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// ─── Custom Log Format ────────────────────────────────────────────────────────

/**
 * Formats each log entry as:
 *   [YYYY-MM-DD HH:mm:ss] LEVEL: message
 * For errors, the stack trace is appended on a new line.
 */
const logFormat = printf(({ level, message, timestamp: ts, stack }) => {
  const base = `[${ts}] ${level}: ${message}`;
  return stack ? `${base}\n${stack}` : base;
});

// ─── Logger Instance ──────────────────────────────────────────────────────────

/**
 * Singleton application logger.
 *
 * Log level hierarchy (low → high):
 *   silly → debug → verbose → http → info → warn → error
 *
 * Set `NODE_ENV=debug` to enable verbose output during development.
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat,
  ),
  transports: [
    // ── Console (colourised) ──────────────────────────────────────────────
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat,
      ),
    }),

    // ── errors.log (assessment deliverable – error-level only) ────────────
    new winston.transports.File({
      filename: path.resolve(process.cwd(), 'errors.log'),
      level: 'error',
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat,
      ),
    }),

    // ── scraper.log (combined – all levels) ───────────────────────────────
    new winston.transports.File({
      filename: path.resolve(process.cwd(), 'scraper.log'),
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat,
      ),
    }),
  ],
  exitOnError: false,
});
