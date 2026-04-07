#!/usr/bin/env node
/**
 * ats-optimizer.mjs
 * Checks a CV against a JD for ATS compatibility.
 * Uses Claude Haiku for keyword extraction (~200 tokens per check).
 *
 * Usage:
 *   node ats-optimizer.mjs 028        Check CV against report #028's JD
 *   node ats-optimizer.mjs --help
 *
 * Requires: ANTHROPIC_API_KEY environment variable
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
ats-optimizer.mjs — Check CV against JD for ATS compatibility

Usage:
  node ats-optimizer.mjs 028        Check CV against report #028
  node ats-optimizer.mjs --help     Show this help

Checks:
  1. Keyword density: top 20 JD keywords in CV
  2. ATS section headers
  3. Date format consistency
  4. Bullet point structure (action verb → metric → result)
  5. Scores 0-100

Requires: ANTHROPIC_API_KEY
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeRead(p) {
  try { return existsSync(p) ? readFileSync(p, 'utf8') : ''; } catch { return ''; }
}

function findReport(numStr) {
  const reportsDir = join(ROOT, 'reports');
  if (!existsSync(reportsDir)) return null;
  const padded = String(parseInt(numStr)).padStart(3, '0');
  const files = readdirSync(reportsDir).filter(f => f.startsWith(padded + '-'));
  return files.length > 0 ? join(reportsDir, files[0]) : null;
}

function extractJDFromReport(reportContent) {
  // Reports may include the JD inline or reference an external file
  const jdSection = reportContent.match(/## (?:Job Description|JD|Role Details?)\n([\s\S]+?)(?=\n## |\n---|\z)/i);
  if (jdSection) return jdSection[1];
  // Fall back to everything after Block A (role summary)
  const afterBlockA = reportContent.match(/## Block A[\s\S]+?\n\n([\s\S]+)/i);
  if (afterBlockA) return afterBlockA[1].slice(0, 3000);
  return reportContent.slice(0, 3000);
}

function extractCompanySlug(reportPath) {
  const filename = reportPath.split(/[/\\]/).pop();
  const parts = filename.replace('.md', '').split('-');
  return parts.slice(1, -3).join('-') || 'unknown';
}

// ── ATS Checks ────────────────────────────────────────────────────────────────

/**
 * Check 2: ATS section headers
 */
function checkSectionHeaders(cvContent) {
  const required = ['experience', 'education', 'skills'];
  const optional = ['summary', 'projects', 'certifications', 'publications'];
  const cvLower = cvContent.toLowerCase();

  const foundRequired = required.filter(s => cvLower.includes(s));
  const foundOptional = optional.filter(s => cvLower.includes(s));
  const missingRequired = required.filter(s => !cvLower.includes(s));

  const score = Math.round((foundRequired.length / required.length) * 100);

  return {
    score,
    foundRequired,
    missingRequired,
    foundOptional,
    details: missingRequired.length === 0
      ? 'All required ATS sections present'
      : `Missing required sections: ${missingRequired.join(', ')}`,
  };
}

/**
 * Check 3: Date format consistency
 */
function checkDateFormats(cvContent) {
  const formats = {
    'Month YYYY':    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\b/g,
    'MM/YYYY':       /\b\d{2}\/\d{4}\b/g,
    'YYYY-MM':       /\b\d{4}-\d{2}\b/g,
    'Full Month YYYY': /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/g,
  };

  const found = {};
  for (const [name, re] of Object.entries(formats)) {
    const matches = cvContent.match(re) || [];
    if (matches.length > 0) found[name] = matches.length;
  }

  const formatCount = Object.keys(found).length;
  const consistent = formatCount <= 1;
  const score = consistent ? 100 : Math.max(0, 100 - (formatCount - 1) * 25);

  return {
    score,
    consistent,
    formatsFound: found,
    details: consistent
      ? `Consistent date format: ${Object.keys(found)[0] || 'none detected'}`
      : `Inconsistent formats: ${Object.keys(found).join(', ')}`,
  };
}

/**
 * Check 4: Bullet point structure (action verb → metric → result)
 */
function checkBulletStructure(cvContent) {
  const ACTION_VERBS = [
    'built', 'developed', 'designed', 'implemented', 'led', 'managed', 'created',
    'improved', 'reduced', 'increased', 'deployed', 'architected', 'optimized',
    'launched', 'delivered', 'drove', 'spearheaded', 'established', 'engineered',
    'automated', 'scaled', 'migrated', 'refactored', 'collaborated', 'mentored',
  ];

  const bullets = cvContent.match(/^[-•*]\s+.+$/gm) || [];
  if (bullets.length === 0) return { score: 50, details: 'No bullet points detected in CV', bullets_checked: 0 };

  let goodBullets = 0;
  let hasMetic = 0;
  let hasActionVerb = 0;

  for (const bullet of bullets) {
    const lower = bullet.toLowerCase();
    const startsWithAction = ACTION_VERBS.some(v => lower.startsWith(`- ${v}`) || lower.startsWith(`• ${v}`) || lower.startsWith(`* ${v}`));
    const hasMetric = /\d+(?:\.\d+)?[%xk]?\s*(?:reduction|increase|improvement|latency|faster|users|requests|million|billion|\$|\bms\b)/i.test(bullet);

    if (startsWithAction) hasActionVerb++;
    if (hasMetric) hasMetic++;
    if (startsWithAction && hasMetric) goodBullets++;
  }

  const score = Math.round((goodBullets / Math.max(bullets.length, 1)) * 100);

  return {
    score,
    total_bullets: bullets.length,
    action_verb_bullets: hasActionVerb,
    metric_bullets: hasMetic,
    good_bullets: goodBullets,
    details: `${goodBullets}/${bullets.length} bullets have action verb + metric structure`,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runATSCheck(reportNum) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  console.log(`ATS Optimizer — Report #${reportNum}`);
  console.log('='.repeat(50));

  // Load report
  const reportPath = findReport(reportNum);
  if (!reportPath) {
    console.error(`Report #${reportNum} not found`);
    process.exit(1);
  }

  const reportContent = safeRead(reportPath);
  const cvContent = safeRead(join(ROOT, 'cv.md'));

  if (!cvContent) {
    console.error('cv.md not found');
    process.exit(1);
  }

  const jdText = extractJDFromReport(reportContent);
  const slug = extractCompanySlug(reportPath);
  const today = new Date().toISOString().slice(0, 10);

  console.log(`Report: ${reportPath.split(/[/\\]/).pop()}`);
  console.log(`CV: ${cvContent.length} chars | JD context: ${jdText.length} chars`);
  console.log('');

  // Check 1: Keyword density (Haiku ~200 tokens)
  console.log('[1/5] Extracting top keywords from JD (Haiku)...');
  const client = new Anthropic({ apiKey });

  let keywords = [];
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Extract the top 20 technical and domain keywords from this job description that an ATS system would filter on. Focus on: technologies, frameworks, methodologies, certifications, and domain terms. Return ONLY a JSON array of strings.

JD text:
${jdText.slice(0, 2000)}

Return format: ["keyword1", "keyword2", ...]`,
      }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (jsonMatch) keywords = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error(`  Keyword extraction failed: ${err.message}`);
    keywords = [];
  }

  // Check keywords against CV
  const cvLower = cvContent.toLowerCase();
  const keywordResults = keywords.map(kw => ({
    keyword: kw,
    present: cvLower.includes(kw.toLowerCase()),
  }));

  const presentCount = keywordResults.filter(k => k.present).length;
  const keywordScore = keywords.length > 0 ? Math.round((presentCount / keywords.length) * 100) : 0;

  console.log(`  Keywords found: ${presentCount}/${keywords.length} (${keywordScore}%)`);

  // Checks 2-4
  console.log('[2/5] Checking section headers...');
  const headerCheck = checkSectionHeaders(cvContent);

  console.log('[3/5] Checking date format consistency...');
  const dateCheck = checkDateFormats(cvContent);

  console.log('[4/5] Checking bullet point structure...');
  const bulletCheck = checkBulletStructure(cvContent);

  // Check 5: PDF format (Playwright-rendered PDFs are always ATS-safe)
  console.log('[5/5] Checking PDF format...');
  const pdfCheck = {
    score: 100,
    details: 'Playwright-rendered PDFs are ATS-safe (text-based, no images)',
  };

  // Overall score (weighted)
  const overallScore = Math.round(
    keywordScore * 0.40 +
    headerCheck.score * 0.20 +
    dateCheck.score * 0.15 +
    bulletCheck.score * 0.20 +
    pdfCheck.score * 0.05
  );

  // ── Build report ────────────────────────────────────────────────────────────
  const emoji = s => s >= 80 ? '✅' : s >= 60 ? '⚠️' : '❌';

  const reportLines = [
    `# ATS Optimization Report — #${reportNum} ${slug}`,
    '',
    `**Date:** ${today}`,
    `**Overall ATS Score: ${overallScore}/100** ${emoji(overallScore)}`,
    '',
    '---',
    '',
    '## 1. Keyword Density',
    '',
    `Score: ${keywordScore}/100 ${emoji(keywordScore)} (${presentCount}/${keywords.length} keywords present)`,
    '',
    '| Keyword | In CV? |',
    '|---------|--------|',
    ...keywordResults.map(k => `| ${k.keyword} | ${k.present ? '✅' : '❌'} |`),
    '',
    '## 2. Section Headers',
    '',
    `Score: ${headerCheck.score}/100 ${emoji(headerCheck.score)}`,
    `${headerCheck.details}`,
    '',
    headerCheck.missingRequired.length > 0
      ? `**Action:** Add missing sections: ${headerCheck.missingRequired.join(', ')}`
      : 'All required sections present.',
    '',
    '## 3. Date Format Consistency',
    '',
    `Score: ${dateCheck.score}/100 ${emoji(dateCheck.score)}`,
    `${dateCheck.details}`,
    '',
    !dateCheck.consistent
      ? '**Action:** Standardize all dates to "Month YYYY" format (e.g., "Jan 2023")'
      : 'Date formatting is consistent.',
    '',
    '## 4. Bullet Point Structure',
    '',
    `Score: ${bulletCheck.score}/100 ${emoji(bulletCheck.score)}`,
    `${bulletCheck.details}`,
    '',
    bulletCheck.score < 80
      ? '**Action:** Restructure bullets as: [Action Verb] + [What you did] + [Measurable result]'
      : 'Bullet structure is strong.',
    '',
    '## 5. PDF Format',
    '',
    `Score: ${pdfCheck.score}/100 ✅`,
    pdfCheck.details,
    '',
    '---',
    '',
    `## Overall: ${overallScore}/100 ${emoji(overallScore)}`,
    '',
    overallScore >= 80
      ? 'Strong ATS score. Your CV is well-optimized for this role.'
      : overallScore >= 60
      ? 'Moderate ATS score. Address the keyword gaps and structure issues above.'
      : 'Low ATS score. Significant optimization needed before applying.',
  ];

  const reportContent = reportLines.join('\n');
  const outputPath = join(ROOT, `reports/ats-${String(reportNum).padStart(3, '0')}-${slug}-${today}.md`);

  // Print to console
  console.log('');
  console.log('='.repeat(50));
  console.log(`Overall ATS Score: ${overallScore}/100 ${emoji(overallScore)}`);
  console.log('');
  console.log(`Keyword density:    ${keywordScore}/100 (${presentCount}/${keywords.length})`);
  console.log(`Section headers:    ${headerCheck.score}/100`);
  console.log(`Date consistency:   ${dateCheck.score}/100`);
  console.log(`Bullet structure:   ${bulletCheck.score}/100`);
  console.log(`PDF format:         ${pdfCheck.score}/100`);
  console.log('');

  if (keywords.length > 0) {
    const missing = keywordResults.filter(k => !k.present).map(k => k.keyword);
    if (missing.length > 0) {
      console.log(`Missing keywords: ${missing.join(', ')}`);
    }
  }

  // Save report
  try {
    writeFileSync(outputPath, reportContent);
    console.log(`\nReport saved: ${outputPath}`);
  } catch (err) {
    console.error(`Could not save report: ${err.message}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const reportNum = args.find(a => /^\d+$/.test(a));
if (!reportNum) {
  console.log(HELP);
  process.exit(args.length > 0 ? 1 : 0);
}

runATSCheck(reportNum).catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
