#!/usr/bin/env node
/**
 * funding-radar.mjs
 * Monitors AI company funding news to find hiring opportunities before jobs are posted.
 * Companies that just raised Series B+ are likely to hire in 60-90 days.
 *
 * Usage:
 *   node funding-radar.mjs           Run the funding radar
 *   node funding-radar.mjs --help    Show this help
 *
 * Requires: rss-parser (included in package.json)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import RSSParser from 'rss-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
funding-radar.mjs — Monitor AI funding news for hiring opportunities

Usage:
  node funding-radar.mjs           Run the radar and generate report
  node funding-radar.mjs --help    Show this help

Checks TechCrunch, VentureBeat AI, and Crunchbase News for recent funding rounds.
Filters for Series B+, >$20M, AI/ML/LLM companies.
Saves report to reports/funding-radar-{date}.md
`;

// ── RSS Feeds ─────────────────────────────────────────────────────────────────

const RSS_FEEDS = [
  {
    name: 'TechCrunch AI',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
  },
  {
    name: 'VentureBeat AI',
    url: 'https://venturebeat.com/category/ai/feed/',
  },
  {
    name: 'Crunchbase News',
    url: 'https://news.crunchbase.com/feed/',
  },
];

// ── AI/ML Keywords for filtering ─────────────────────────────────────────────

const AI_KEYWORDS = [
  'artificial intelligence', 'machine learning', 'large language model', 'llm',
  'generative ai', 'gen ai', 'foundation model', 'ai startup', 'ml startup',
  'natural language processing', 'nlp', 'computer vision', 'deep learning',
  'neural network', 'ai platform', 'agentic', 'ai agent', 'chatbot',
  'ai infrastructure', 'mlops', 'ai safety', 'ai research',
];

// Funding round keywords indicating significant raises
const FUNDING_KEYWORDS = [
  'series b', 'series c', 'series d', 'series e', 'growth round',
  'raises', 'raised', 'secures', 'closes', 'funding round', 'investment',
  'valuation', 'venture capital', 'vc funding',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeRead(p) {
  try { return existsSync(p) ? readFileSync(p, 'utf8') : ''; } catch { return ''; }
}

/**
 * Extract funding amount from text. Returns null if not found.
 * @param {string} text
 * @returns {number|null} Amount in millions USD
 */
function extractFundingAmount(text) {
  // Match patterns: "$50 million", "$50M", "$1.2B", "50M", etc.
  const patterns = [
    /\$\s*(\d+(?:\.\d+)?)\s*(?:B|billion)/gi,
    /\$\s*(\d+(?:\.\d+)?)\s*(?:M|million)/gi,
    /(\d+(?:\.\d+)?)\s*(?:B|billion)\s+(?:USD|dollars?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:M|million)\s+(?:USD|dollars?)/gi,
  ];

  let maxAmount = null;

  for (const re of patterns) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const isB = m[0].toLowerCase().includes('b') || m[0].toLowerCase().includes('billion');
      const amount = parseFloat(m[1]) * (isB ? 1000 : 1);
      if (maxAmount === null || amount > maxAmount) maxAmount = amount;
    }
  }

  return maxAmount;
}

/**
 * Extract series round from text.
 */
function extractSeries(text) {
  const seriesMatch = text.match(/series\s+([a-f])\b/i);
  if (seriesMatch) return `Series ${seriesMatch[1].toUpperCase()}`;
  if (/seed\s+round/i.test(text)) return 'Seed';
  if (/growth\s+round/i.test(text)) return 'Growth';
  if (/ipo/i.test(text)) return 'IPO';
  return null;
}

/**
 * Extract company name from article title.
 * Simple heuristic: first proper noun or quoted name.
 */
function extractCompanyName(title) {
  // "CompanyName raises $50M" → "CompanyName"
  const raiseMatch = title.match(/^([A-Z][A-Za-z0-9\s\.]+?)\s+(?:raises?|secures?|closes?|lands?)/);
  if (raiseMatch) return raiseMatch[1].trim();

  // "Funding: CompanyName announced..."
  const fundMatch = title.match(/:\s*([A-Z][A-Za-z0-9\s\.]{2,}?)\s+(?:raises?|secures?|closes?)/);
  if (fundMatch) return fundMatch[1].trim();

  return null;
}

/**
 * Check if company is already in portals.yml or applications.md
 */
function isKnownCompany(companyName) {
  const portals = safeRead(join(ROOT, 'portals.yml'));
  const apps = safeRead(join(ROOT, 'data/applications.md'));
  const name = companyName.toLowerCase();

  if (portals.toLowerCase().includes(name)) return 'portals.yml';
  if (apps.toLowerCase().includes(name)) return 'applications.md';
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runFundingRadar() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`Funding Radar — ${today}`);
  console.log('='.repeat(50));

  const parser = new RSSParser({
    timeout: 15000,
    headers: { 'User-Agent': 'career-ops/1.0 (job search tool)' },
  });

  const allItems = [];

  // Fetch all RSS feeds
  for (const feed of RSS_FEEDS) {
    process.stdout.write(`  Fetching ${feed.name}... `);
    try {
      const result = await parser.parseURL(feed.url);
      const items = (result.items || []).map(item => ({
        ...item,
        sourceName: feed.name,
      }));
      console.log(`${items.length} items`);
      allItems.push(...items);
    } catch (err) {
      console.log(`FAILED (${err.message})`);
    }
  }

  console.log(`\nTotal items: ${allItems.length}`);
  console.log('Filtering for AI funding...\n');

  const qualifyingRounds = [];

  for (const item of allItems) {
    const text = `${item.title || ''} ${item.contentSnippet || item.content || ''}`.toLowerCase();
    const titleText = `${item.title || ''} ${item.contentSnippet || ''}`;

    // Must have AI keyword
    const isAI = AI_KEYWORDS.some(kw => text.includes(kw));
    if (!isAI) continue;

    // Must have funding keyword
    const isFunding = FUNDING_KEYWORDS.some(kw => text.includes(kw));
    if (!isFunding) continue;

    // Extract funding amount
    const amount = extractFundingAmount(titleText);
    if (amount !== null && amount < 20) continue; // Under $20M threshold

    // Extract series
    const series = extractSeries(text);

    // Skip seed rounds (unless no series detected and amount is large)
    if (series === 'Seed' && (amount === null || amount < 50)) continue;

    // Extract company name
    const company = extractCompanyName(item.title || '');

    // Check if already known
    const alreadyKnown = company ? isKnownCompany(company) : null;

    // LinkedIn search URL for this company
    const linkedinSearchUrl = company
      ? `https://www.linkedin.com/jobs/search/?keywords=AI+Engineer&f_C=${encodeURIComponent(company)}`
      : null;

    qualifyingRounds.push({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || '',
      source: item.sourceName,
      company,
      amount,
      series,
      alreadyKnown,
      linkedinSearchUrl,
    });
  }

  console.log(`Qualifying rounds: ${qualifyingRounds.length}`);

  // Sort by amount desc
  qualifyingRounds.sort((a, b) => (b.amount || 0) - (a.amount || 0));

  // ── Generate report ────────────────────────────────────────────────────────

  const reportLines = [
    `# Funding Radar — ${today}`,
    '',
    `**Feeds checked:** ${RSS_FEEDS.map(f => f.name).join(', ')}`,
    `**Total items scanned:** ${allItems.length}`,
    `**Qualifying rounds (AI, Series B+, >$20M):** ${qualifyingRounds.length}`,
    '',
    '---',
    '',
    '## Qualifying Funding Rounds',
    '',
  ];

  if (qualifyingRounds.length === 0) {
    reportLines.push('No qualifying rounds found in current feed data.');
  } else {
    for (const round of qualifyingRounds) {
      reportLines.push(`### ${round.company || 'Unknown Company'}`);
      reportLines.push('');
      reportLines.push(`- **Title:** ${round.title}`);
      reportLines.push(`- **Source:** ${round.source}`);
      if (round.series)   reportLines.push(`- **Round:** ${round.series}`);
      if (round.amount)   reportLines.push(`- **Amount:** $${round.amount}M`);
      if (round.pubDate)  reportLines.push(`- **Date:** ${round.pubDate}`);
      reportLines.push(`- **Article:** ${round.link}`);
      if (round.alreadyKnown) {
        reportLines.push(`- **Status:** Already tracked in ${round.alreadyKnown}`);
      } else {
        reportLines.push(`- **Status:** NEW — not yet in pipeline`);
        reportLines.push(`- **Note:** Recently raised — hiring likely in 60-90 days`);
        if (round.linkedinSearchUrl) {
          reportLines.push(`- **Search:** [LinkedIn jobs at ${round.company}](${round.linkedinSearchUrl})`);
        }
      }
      reportLines.push('');
    }
  }

  reportLines.push('---');
  reportLines.push('');
  reportLines.push('## Action Items');
  reportLines.push('');
  const newCompanies = qualifyingRounds.filter(r => !r.alreadyKnown && r.company);
  if (newCompanies.length > 0) {
    reportLines.push(`${newCompanies.length} new companies to investigate:`);
    for (const r of newCompanies) {
      reportLines.push(`- [ ] ${r.company} (${r.series || 'funding'}, $${r.amount || '?'}M) — ${r.link}`);
    }
  } else {
    reportLines.push('No new companies identified this run.');
  }

  const reportContent = reportLines.join('\n');

  // Save report
  const reportPath = join(ROOT, `reports/funding-radar-${today}.md`);
  try {
    writeFileSync(reportPath, reportContent);
    console.log(`\nReport saved: ${reportPath}`);
  } catch (err) {
    console.error(`Could not save report: ${err.message}`);
    console.log('\n--- REPORT ---\n');
    console.log(reportContent);
  }

  console.log('\nDone.');
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

runFundingRadar().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
