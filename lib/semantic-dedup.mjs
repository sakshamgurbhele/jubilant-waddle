/**
 * lib/semantic-dedup.mjs
 * Lightweight TF-IDF based semantic deduplication (pure JS, no external API).
 *
 * Prevents re-evaluating jobs that are semantically identical (same role
 * posted on multiple boards, re-listed jobs, etc.).
 *
 * Threshold: 0.82 cosine similarity = likely duplicate
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX_PATH = join(ROOT, 'data/dedup-index.json');

// English stopwords to remove before vectorizing
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'this', 'that', 'these', 'those', 'i', 'we', 'you', 'he',
  'she', 'it', 'they', 'what', 'which', 'who', 'whom', 'when', 'where',
  'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'not', 'only', 'same', 'so', 'than', 'too',
  'very', 'just', 'also', 'as', 'up', 'out', 'about', 'into', 'through',
  'our', 'your', 'their', 'its', 'my', 'his', 'her', 'we', 'us', 'them',
]);

/** In-memory index: array of {id, company, title, vector} */
let _index = null;

/**
 * Tokenize text into lowercase words, removing stopwords and short tokens.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Build a TF-IDF-style term frequency vector from text.
 * Returns a plain object mapping term → normalized frequency.
 * @param {string} text
 * @returns {Object.<string, number>}
 */
export function buildVector(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return {};

  // Term frequency
  const tf = {};
  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }

  // Normalize by document length
  const total = tokens.length;
  for (const term in tf) {
    tf[term] = tf[term] / total;
  }

  return tf;
}

/**
 * Compute cosine similarity between two TF vectors.
 * @param {Object} vec1
 * @param {Object} vec2
 * @returns {number} Similarity 0-1
 */
export function cosineSimilarity(vec1, vec2) {
  const keys1 = Object.keys(vec1);
  const keys2 = new Set(Object.keys(vec2));

  if (keys1.length === 0 || keys2.size === 0) return 0;

  // Dot product
  let dot = 0;
  for (const k of keys1) {
    if (keys2.has(k)) dot += vec1[k] * vec2[k];
  }

  // Magnitudes
  const mag1 = Math.sqrt(keys1.reduce((s, k) => s + vec1[k] ** 2, 0));
  const mag2 = Math.sqrt([...keys2].reduce((s, k) => s + vec2[k] ** 2, 0));

  if (mag1 === 0 || mag2 === 0) return 0;
  return dot / (mag1 * mag2);
}

/**
 * Build the text fingerprint for a job (company + title + first 300 chars of description).
 * @param {Object} job
 * @param {string} job.company
 * @param {string} job.title
 * @param {string} [job.description]
 * @returns {string}
 */
function jobFingerprint(job) {
  const desc = (job.description || job.jdText || '').slice(0, 300);
  return `${job.company || ''} ${job.title || ''} ${desc}`;
}

/**
 * Load the dedup index from disk into memory.
 * Safe to call multiple times (idempotent).
 */
export async function loadIndex() {
  if (_index !== null) return; // Already loaded

  if (existsSync(INDEX_PATH)) {
    try {
      const raw = readFileSync(INDEX_PATH, 'utf8');
      _index = JSON.parse(raw);
      if (!Array.isArray(_index)) _index = [];
    } catch {
      _index = [];
    }
  } else {
    _index = [];
  }
}

/**
 * Save the in-memory index to disk.
 */
export async function saveIndex() {
  if (_index === null) return;
  try {
    writeFileSync(INDEX_PATH, JSON.stringify(_index, null, 2), 'utf8');
  } catch (err) {
    console.error('[semantic-dedup] Failed to save index:', err.message);
  }
}

/**
 * Add a job to the dedup index.
 * @param {Object} job - Must have company, title fields
 */
export async function addToIndex(job) {
  if (_index === null) await loadIndex();
  const text = jobFingerprint(job);
  const vector = buildVector(text);
  const id = `${(job.company || '').toLowerCase().replace(/\s+/g, '-')}_${(job.title || '').toLowerCase().replace(/\s+/g, '-')}`;

  _index.push({ id, company: job.company, title: job.title, vector });
  await saveIndex();
}

/**
 * Check if a job is a duplicate of anything in the seen jobs.
 * Uses cosine similarity with TF-IDF vectors.
 *
 * @param {Object} newJob      - The new job to check
 * @param {Array}  seenJobs    - Array of previously seen job objects (optional, uses index if empty)
 * @param {number} [threshold] - Similarity threshold (default: 0.82)
 * @returns {Promise<boolean>}
 */
export async function isDuplicate(newJob, seenJobs = [], threshold = 0.82) {
  if (_index === null) await loadIndex();

  const newText = jobFingerprint(newJob);
  const newVec = buildVector(newText);

  // Check against provided seenJobs first
  for (const seen of seenJobs) {
    const seenText = jobFingerprint(seen);
    const seenVec = buildVector(seenText);
    const sim = cosineSimilarity(newVec, seenVec);
    if (sim >= threshold) return true;
  }

  // Check against persistent index
  for (const entry of _index) {
    if (!entry.vector) continue;
    const sim = cosineSimilarity(newVec, entry.vector);
    if (sim >= threshold) return true;
  }

  return false;
}

/**
 * Get the current index size.
 * @returns {number}
 */
export function getIndexSize() {
  return _index ? _index.length : 0;
}

/**
 * Clear the index (useful for testing).
 */
export function clearIndex() {
  _index = [];
}
