#!/usr/bin/env node
/**
 * ghost-detector.mjs
 * Detects likely-fake or stale job postings before wasting tokens evaluating them.
 *
 * Usage:
 *   node ghost-detector.mjs --url "https://..."   Check a specific URL
 *   node ghost-detector.mjs --text "JD text"      Check raw JD text
 *   node ghost-detector.mjs --help
 *
 * Ghost score >= 6 = likely ghost posting (returns isLikelyGhost: true)
 */

import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
ghost-detector.mjs — Detect ghost/stale job postings

Usage:
  node ghost-detector.mjs --url "https://..."     Check a job URL
  node ghost-detector.mjs --text "job text"       Check JD text directly
  node ghost-detector.mjs --json                  Output as JSON
  node ghost-detector.mjs --help

Ghost score >= 6 = likely ghost (skip evaluation)
Score 4-5 = suspicious (evaluate with caution)
Score < 4 = probably real

Exit codes:
  0 = real posting
  1 = error
  2 = likely ghost
`;

// ── Companies known for ghost posting / frequent layoffs ──────────────────────
// Note: These companies aren't necessarily always ghost-posting, but their postings
// warrant extra verification due to recent layoffs and high repost frequency.

const EXTRA_VERIFY_COMPANIES = new Set([
  'google', 'alphabet', 'meta', 'facebook', 'amazon', 'microsoft',
  'salesforce', 'twitter', 'x corp', 'oracle', 'ibm', 'intel',
  'cisco', 'hp', 'hewlett', 'dell', 'snap', 'lyft', 'uber',
  'stripe', 'coinbase', 'robinhood', 'opendoor', 'better.com',
  'peloton', 'shopify', 'spotify',
]);

// Companies with confirmed major layoffs 2023-2024
const LAYOFF_COMPANIES = new Set([
  'google', 'alphabet', 'meta', 'facebook', 'amazon', 'microsoft',
  'salesforce', 'twitter', 'x corp', 'oracle', 'ibm', 'intel',
  'cisco', 'hp', 'dell', 'snap', 'lyft', 'uber', 'stripe',
  'coinbase', 'robinhood', 'opendoor', 'better.com', 'peloton',
  'shopify', 'spotify', 'zoom', 'dropbox', 'twilio', 'zendesk',
  'atlassian', 'hubspot', 'docusign', 'workday',
]);

// ── Ghost job signals ─────────────────────────────────────────────────────────

/**
 * Analyze text for ghost job signals.
 * Each signal contributes to a score; score >= 6 = likely ghost.
 *
 * @param {Object} params
 * @param {string} [params.url]        - Job posting URL
 * @param {string} [params.text]       - JD text content
 * @param {string} [params.company]    - Company name
 * @param {string} [params.postedDate] - Posted date string (ISO or relative)
 * @returns {{isLikelyGhost: boolean, score: number, reasons: string[], confidence: string}}
 */
export function detectGhost({ url = '', text = '', company = '', postedDate = '' }) {
  const reasons = [];
  let score = 0;

  const lowerText = text.toLowerCase();
  const lowerUrl  = url.toLowerCase();
  const lowerComp = company.toLowerCase();

  // ── Signal 1: Page says not accepting applications (+3) ───────────────────
  if (
    /no longer accepting applications/i.test(text) ||
    /this job is no longer available/i.test(text) ||
    /position has been filled/i.test(text) ||
    /job listing has expired/i.test(text) ||
    /application period.*closed/i.test(text)
  ) {
    score += 3;
    reasons.push('Posting explicitly closed ("no longer accepting applications")');
  }

  // ── Signal 2: Posted date > 90 days (+3) or 30-90 days (+1) ─────────────
  if (postedDate) {
    const parsed = parsePostedDate(postedDate);
    if (parsed) {
      const daysOld = (Date.now() - parsed) / (1000 * 60 * 60 * 24);
      if (daysOld > 90) {
        score += 3;
        reasons.push(`Old posting: ${Math.floor(daysOld)} days ago (>90 days)`);
      } else if (daysOld > 30) {
        score += 1;
        reasons.push(`Aging posting: ${Math.floor(daysOld)} days ago (30-90 days)`);
      }
    }
  }

  // Also check for date clues in text
  const textDateSignals = [
    { pattern: /posted\s+(\d+)\s+months?\s+ago/i, multiplier: 30 },
    { pattern: /(\d+)\s+months?\s+ago/i, multiplier: 30 },
  ];
  for (const { pattern, multiplier } of textDateSignals) {
    const m = text.match(pattern);
    if (m) {
      const daysOld = parseInt(m[1]) * multiplier;
      if (daysOld > 90 && !reasons.some(r => r.includes('posting'))) {
        score += 3;
        reasons.push(`Old posting: ~${daysOld} days ago (>90 days)`);
      } else if (daysOld > 30 && !reasons.some(r => r.includes('posting'))) {
        score += 1;
        reasons.push(`Aging posting: ~${daysOld} days ago (30-90 days)`);
      }
    }
  }

  // ── Signal 3: Staffing agency for unnamed client (+2) ──────────────────────
  if (
    /\bour\s+client\b/i.test(text) ||
    /\bconfidential\s+(?:client|employer)\b/i.test(text) ||
    /\bIT\s+staffing\b/i.test(text) ||
    /\bstaffing\s+agenc/i.test(text) ||
    /\bcontract\s+(?:to\s+hire|position)\b/i.test(text) ||
    /\bw2\s+contractor\b/i.test(text) ||
    /\bc2c\s+only\b/i.test(text) ||
    (/\bconsulting\s+firm\b/i.test(text) && /\bplacement\b/i.test(text))
  ) {
    score += 2;
    reasons.push('Staffing agency posting for unnamed client');
  }

  // ── Signal 4: Company known for layoffs (+2) ──────────────────────────────
  if (LAYOFF_COMPANIES.has(lowerComp) || [...LAYOFF_COMPANIES].some(c => lowerComp.includes(c))) {
    score += 2;
    reasons.push(`Company (${company}) had significant layoffs in 2023-2024 — verify posting is real`);
  }

  // ── Signal 5: Appears on multiple platforms (+3) ─────────────────────────
  // (Heuristic: can't actually cross-check without multiple fetches, but flag if URL pattern suggests aggregator)
  if (
    /\bjobs\.lever\.co\b/i.test(url) ||
    /\bworkday\.com\b/i.test(url) ||
    /\bgreenhousejobs\b/i.test(url)
  ) {
    // These are ATS platforms (legitimate), lower risk
  } else if (
    /\bindeed\.com\b/i.test(url) ||
    /\bzip\s*recruiter\b/i.test(lowerText) ||
    /\bcareerbuilder\b/i.test(lowerText)
  ) {
    score += 1;
    reasons.push('Posted on aggregator — may be syndicated stale listing');
  }

  // ── Signal 6: Generic/template JD language (mild signal +1) ──────────────
  const templatePhrases = [
    /we are looking for a talented\s+(?:and motivated\s+)?(?:individual|candidate)/i,
    /competitive (?:salary|compensation) (?:package\s+)?(?:and benefits)?\.?\s*$/im,
    /equal opportunity employer/i,
    /fast-paced environment/i,
  ];
  const templateCount = templatePhrases.filter(p => p.test(text)).length;
  if (templateCount >= 3) {
    score += 1;
    reasons.push('Highly generic/template JD language — low specificity');
  }

  // ── Signal 7: Extra verify companies ─────────────────────────────────────
  if (EXTRA_VERIFY_COMPANIES.has(lowerComp) || [...EXTRA_VERIFY_COMPANIES].some(c => lowerComp.includes(c))) {
    if (!reasons.some(r => r.includes('layoffs'))) {
      // Add as a note, not scored
      reasons.push(`Note: ${company} is in the extra-verify list — confirm posting is active`);
    }
  }

  // ── Determine confidence ──────────────────────────────────────────────────
  let confidence;
  if (score >= 8) confidence = 'high';
  else if (score >= 5) confidence = 'medium';
  else confidence = 'low';

  const isLikelyGhost = score >= 6;

  return {
    isLikelyGhost,
    score,
    maxScore: 13,
    reasons,
    confidence,
  };
}

/**
 * Parse a posted date string into a timestamp.
 * Handles ISO dates and relative strings.
 */
function parsePostedDate(dateStr) {
  if (!dateStr) return null;

  // Try ISO format first
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.getTime();

  // Relative: "30 days ago", "2 months ago"
  const daysMatch = dateStr.match(/(\d+)\s+days?\s+ago/i);
  if (daysMatch) {
    return Date.now() - parseInt(daysMatch[1]) * 24 * 60 * 60 * 1000;
  }

  const monthsMatch = dateStr.match(/(\d+)\s+months?\s+ago/i);
  if (monthsMatch) {
    return Date.now() - parseInt(monthsMatch[1]) * 30 * 24 * 60 * 60 * 1000;
  }

  const weeksMatch = dateStr.match(/(\d+)\s+weeks?\s+ago/i);
  if (weeksMatch) {
    return Date.now() - parseInt(weeksMatch[1]) * 7 * 24 * 60 * 60 * 1000;
  }

  return null;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

if (args.includes('--url') || args.includes('--text')) {
  const urlIdx  = args.indexOf('--url');
  const textIdx = args.indexOf('--text');
  const jsonOut = args.includes('--json');

  const url  = urlIdx  !== -1 ? args[urlIdx + 1]  : '';
  const text = textIdx !== -1 ? args[textIdx + 1] : '';

  const result = detectGhost({ url, text });

  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Ghost Score: ${result.score}/${result.maxScore} (${result.confidence} confidence)`);
    console.log(`Verdict: ${result.isLikelyGhost ? 'LIKELY GHOST — skip' : 'Probably real'}`);
    if (result.reasons.length > 0) {
      console.log('\nSignals:');
      for (const r of result.reasons) console.log(`  - ${r}`);
    }
  }

  process.exit(result.isLikelyGhost ? 2 : 0);
}

// If no args, print help
if (args.length === 0) {
  console.log(HELP);
  process.exit(0);
}
