/**
 * lib/worker-pool.mjs
 * Parallel evaluation worker pool with atomic sequential report numbering.
 *
 * Uses p-limit for concurrency control and a .seq-lock file for atomic
 * number assignment to prevent numbering conflicts in parallel runs.
 */

import { readdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pLimit from 'p-limit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORTS_DIR = join(ROOT, 'reports');
const LOCK_FILE = join(ROOT, '.seq-lock');
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_MAX_RETRIES = 40; // 2 seconds total

// Session-level stats
const _stats = {
  completed: 0,
  failed: 0,
  in_progress: 0,
  tokens_used: 0,
};

/**
 * Try to acquire the sequence lock file.
 * Returns true if acquired, false if already locked.
 */
function tryAcquireLock() {
  if (existsSync(LOCK_FILE)) {
    // Check if lock is stale (> 10 seconds old)
    try {
      const lockData = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
      const age = Date.now() - (lockData.ts || 0);
      if (age > 10000) {
        unlinkSync(LOCK_FILE); // Remove stale lock
        return false; // Retry acquisition
      }
    } catch {
      unlinkSync(LOCK_FILE);
    }
    return false;
  }
  try {
    writeFileSync(LOCK_FILE, JSON.stringify({ ts: Date.now(), pid: process.pid }), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the sequence lock.
 */
function releaseLock() {
  try {
    if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE);
  } catch { /* ignore */ }
}

/**
 * Sleep for ms milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get the next available report number atomically.
 * Reads current max from reports/ directory, increments, and returns.
 * Uses a .seq-lock file for mutual exclusion.
 *
 * @returns {Promise<number>} Next report number (e.g., 42 → used as "042")
 */
export async function getNextReportNumber() {
  // Acquire lock with retry
  let retries = 0;
  while (!tryAcquireLock()) {
    if (retries++ >= LOCK_MAX_RETRIES) {
      throw new Error('Could not acquire sequence lock after max retries');
    }
    await sleep(LOCK_RETRY_DELAY_MS);
  }

  try {
    // Find max existing report number
    let maxNum = 0;
    if (existsSync(REPORTS_DIR)) {
      const files = readdirSync(REPORTS_DIR)
        .filter(f => /^\d{3}-.+\.md$/.test(f));
      for (const f of files) {
        const num = parseInt(f.slice(0, 3));
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    }
    return maxNum + 1;
  } finally {
    releaseLock();
  }
}

/**
 * Format a report number as zero-padded 3-digit string.
 * @param {number} num
 * @returns {string} e.g. 42 → "042"
 */
export function formatReportNumber(num) {
  return String(num).padStart(3, '0');
}

/**
 * Worker pool for parallel job evaluation with concurrency control.
 */
export class WorkerPool {
  /**
   * @param {number} concurrency - Max parallel workers (default: 5)
   */
  constructor(concurrency = 5) {
    this.concurrency = concurrency;
    this._limit = pLimit(concurrency);
    this._results = [];
  }

  /**
   * Get current stats.
   * @returns {{completed: number, failed: number, in_progress: number, tokens_used: number}}
   */
  getStats() {
    return { ..._stats };
  }

  /**
   * Get the next report number (delegates to module-level function).
   * @returns {Promise<number>}
   */
  async getNextReportNumber() {
    return getNextReportNumber();
  }

  /**
   * Process an array of jobs in parallel with concurrency limiting.
   * Results are returned in the same order as the input jobs array.
   *
   * @param {Array} jobs - Array of job objects to process
   * @param {Function} evaluatorFn - Async function: (job, index) => result
   * @returns {Promise<Array>} Results in same order as jobs
   */
  async run(jobs, evaluatorFn) {
    _stats.in_progress = 0;
    _stats.completed = 0;
    _stats.failed = 0;

    const promises = jobs.map((job, index) =>
      this._limit(async () => {
        _stats.in_progress++;
        try {
          const result = await evaluatorFn(job, index);
          _stats.completed++;
          _stats.in_progress--;
          if (result && result.tokens_used) {
            _stats.tokens_used += result.tokens_used;
          }
          return { success: true, result, job, index };
        } catch (err) {
          _stats.failed++;
          _stats.in_progress--;
          console.error(`[WorkerPool] Job ${index} failed: ${err.message}`);
          return { success: false, error: err.message, job, index };
        }
      })
    );

    const results = await Promise.all(promises);

    // Sort by original index to preserve order
    return results.sort((a, b) => a.index - b.index);
  }
}

/**
 * Default export: a ready-to-use WorkerPool instance with concurrency=5.
 */
export default new WorkerPool(5);
