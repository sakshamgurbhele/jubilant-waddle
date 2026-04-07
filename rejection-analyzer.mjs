#!/usr/bin/env node
/**
 * rejection-analyzer.mjs
 * After 20+ rejections, finds patterns to improve your job search.
 *
 * Usage:
 *   node rejection-analyzer.mjs          Run analysis
 *   node rejection-analyzer.mjs --help
 *
 * Requires: ANTHROPIC_API_KEY
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
rejection-analyzer.mjs — Find patterns in rejections to improve your search

Usage:
  node rejection-analyzer.mjs          Run analysis (needs 10+ rejections)
  node rejection-analyzer.mjs --help   Show this help

Analysis includes:
  - Rejection patterns by company size, location, score range, role type
  - Time-to-rejection analysis (ATS filter vs recruiter screen vs post-interview)
  - Score accuracy assessment
  - 3-5 actionable recommendations

Output saved to reports/rejection-analysis-{date}.md

Requires: ANTHROPIC_API_KEY
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeRead(p) {
  try { return existsSync(p) ? readFileSync(p, 'utf8') : ''; } catch { return ''; }
}

function daysBetween(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  if (isNaN(d1) || isNaN(d2)) return null;
  return Math.floor(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
}

// ── Parse applications ────────────────────────────────────────────────────────

function parseApplications() {
  const content = safeRead(join(ROOT, 'data/applications.md'));
  if (!content) return [];

  const apps = [];
  for (const line of content.split('\n')) {
    if (!line.startsWith('|') || line.includes('---') || line.includes('Company')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 7) continue;
    const num     = parseInt(parts[1]);
    const date    = parts[2];
    const company = parts[3];
    const role    = parts[4];
    const score   = parseFloat((parts[5] || '0').replace('/5', '')) || 0;
    const status  = parts[6];
    const notes   = parts[9] || parts[8] || '';
    if (!isNaN(num) && num > 0) apps.push({ num, date, company, role, score, status, notes });
  }
  return apps;
}

// ── Classify rejection timing ─────────────────────────────────────────────────

function classifyRejectionTiming(daysToReject) {
  if (daysToReject === null) return 'unknown';
  if (daysToReject < 1)  return 'immediate (same day - ATS auto-filter)';
  if (daysToReject < 3)  return 'fast (1-3 days - likely ATS or automated)';
  if (daysToReject < 7)  return 'quick (3-7 days - recruiter screen)';
  if (daysToReject < 21) return 'normal (1-3 weeks - hiring manager review)';
  return 'slow (3+ weeks - likely deeper in process)';
}

// ── Main analysis ─────────────────────────────────────────────────────────────

async function runAnalysis() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const apps = parseApplications();
  const rejected = apps.filter(a => a.status === 'Rejected');
  const applied  = apps.filter(a => ['Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded'].includes(a.status));

  console.log(`Rejection Analyzer`);
  console.log('='.repeat(50));
  console.log(`Total applications: ${apps.length}`);
  console.log(`Applied: ${applied.length}`);
  console.log(`Rejected: ${rejected.length}`);
  console.log('');

  if (rejected.length < 10) {
    console.log(`Only ${rejected.length} rejections found. Need at least 10 for meaningful analysis.`);
    console.log('Keep applying — data will improve with volume.');
    process.exit(0);
  }

  // ── Statistical analysis ────────────────────────────────────────────────────

  // Score distribution of rejections
  const scoreGroups = {
    'Low (< 3.5)':     rejected.filter(a => a.score < 3.5),
    'Mid (3.5-4.0)':   rejected.filter(a => a.score >= 3.5 && a.score < 4.0),
    'High (4.0-4.5)':  rejected.filter(a => a.score >= 4.0 && a.score < 4.5),
    'Top (>= 4.5)':    rejected.filter(a => a.score >= 4.5),
  };

  // Role type analysis
  const roleTypes = {};
  for (const app of rejected) {
    const role = app.role.toLowerCase();
    let type = 'Other';
    if (/senior/i.test(role)) type = 'Senior';
    else if (/staff/i.test(role)) type = 'Staff';
    else if (/principal/i.test(role)) type = 'Principal';
    else if (/engineer/i.test(role)) type = 'Engineer';
    else if (/manager/i.test(role)) type = 'Manager';
    roleTypes[type] = (roleTypes[type] || 0) + 1;
  }

  // Location analysis
  const locTypes = {};
  for (const app of rejected) {
    const notes = app.notes.toLowerCase();
    let loc = 'Unknown';
    if (/remote/i.test(notes + app.role)) loc = 'Remote';
    else if (/new\s*york|nyc/i.test(notes + app.role)) loc = 'NYC';
    else if (/san\s*francisco|sf\b/i.test(notes + app.role)) loc = 'SF';
    else if (/austin/i.test(notes + app.role)) loc = 'Austin';
    locTypes[loc] = (locTypes[loc] || 0) + 1;
  }

  // Score accuracy: high-score rejections
  const highScoreRejections = rejected.filter(a => a.score >= 4.0);
  const rejectionRate = applied.length > 0 ? ((rejected.length / applied.length) * 100).toFixed(1) : 0;

  // ── Load report samples for AI analysis ────────────────────────────────────

  const reportsDir = join(ROOT, 'reports');
  const sampleReports = [];
  const samplesToLoad = Math.min(5, highScoreRejections.length || rejected.length);
  const sampleJobs = highScoreRejections.length >= 3
    ? highScoreRejections.slice(0, samplesToLoad)
    : rejected.slice(0, samplesToLoad);

  for (const job of sampleJobs) {
    const padded = String(job.num).padStart(3, '0');
    if (!existsSync(reportsDir)) break;
    const files = readdirSync(reportsDir).filter(f => f.startsWith(padded + '-'));
    if (files.length > 0) {
      const content = safeRead(join(reportsDir, files[0]));
      sampleReports.push({
        company: job.company,
        role: job.role,
        score: job.score,
        reportSnippet: content.slice(0, 800),
      });
    }
  }

  console.log('Sending sample reports to Sonnet for pattern analysis...');

  const client = new Anthropic({ apiKey });
  let aiInsights = '';

  if (sampleReports.length > 0) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Analyze these ${sampleReports.length} rejected job applications and identify 3-5 specific, actionable patterns or recommendations.

${sampleReports.map(r => `
Company: ${r.company}
Role: ${r.role}
Score: ${r.score}/5
Report snippet: ${r.reportSnippet}
---`).join('\n')}

Statistics:
- Total rejections: ${rejected.length}
- High-score rejections (4.0+): ${highScoreRejections.length}
- Score groups: ${Object.entries(scoreGroups).map(([k,v]) => `${k}: ${v.length}`).join(', ')}

Provide 3-5 specific, actionable recommendations. Format each as:
**Pattern:** [what you observed]
**Action:** [specific thing to change or do differently]

Be brutally honest and specific. Generic advice is useless.`,
      }],
    });
    aiInsights = response.content[0].text.trim();
  }

  // ── Generate report ─────────────────────────────────────────────────────────

  const today = new Date().toISOString().slice(0, 10);
  const reportLines = [
    `# Rejection Analysis — ${today}`,
    '',
    `**Total evaluations:** ${apps.length}  `,
    `**Applied:** ${applied.length}  `,
    `**Rejected:** ${rejected.length} (${rejectionRate}% rejection rate)  `,
    `**High-score rejections (≥4.0):** ${highScoreRejections.length}  `,
    '',
    '---',
    '',
    '## Score Distribution of Rejections',
    '',
    '| Score Range | Count | % of Rejections |',
    '|-------------|-------|----------------|',
    ...Object.entries(scoreGroups).map(([k, v]) =>
      `| ${k} | ${v.length} | ${rejected.length > 0 ? ((v.length / rejected.length * 100).toFixed(1)) : 0}% |`
    ),
    '',
    '## Role Type Analysis',
    '',
    '| Role Type | Rejections |',
    '|-----------|-----------|',
    ...Object.entries(roleTypes).sort(([,a],[,b]) => b - a).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Location Analysis',
    '',
    '| Location | Rejections |',
    '|----------|-----------|',
    ...Object.entries(locTypes).sort(([,a],[,b]) => b - a).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## High-Score Rejections (≥ 4.0)',
    '',
    'These are the most important to analyze — you predicted a good fit but got rejected.',
    '',
    '| # | Company | Role | Score |',
    '|---|---------|------|-------|',
    ...highScoreRejections.slice(0, 15).map(a =>
      `| ${String(a.num).padStart(3,'0')} | ${a.company} | ${a.role} | ${a.score}/5 |`
    ),
    '',
    '---',
    '',
    '## AI Pattern Analysis',
    '',
    aiInsights || '_Could not generate AI analysis (no sample reports found)._',
    '',
    '---',
    '',
    '## Next Steps',
    '',
    '- [ ] Review high-score rejections in detail',
    '- [ ] Apply recommendations above',
    '- [ ] Re-run analysis after 20 more applications',
  ];

  const reportContent = reportLines.join('\n');
  const outputPath = join(ROOT, `reports/rejection-analysis-${today}.md`);

  writeFileSync(outputPath, reportContent);
  console.log(`\nReport saved: ${outputPath}`);

  // Print summary
  console.log('');
  console.log('Key stats:');
  console.log(`  Rejection rate: ${rejectionRate}%`);
  console.log(`  High-score rejections (4.0+): ${highScoreRejections.length}`);
  if (aiInsights) {
    console.log('');
    console.log('AI recommendations:');
    console.log(aiInsights.slice(0, 400) + (aiInsights.length > 400 ? '...' : ''));
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

runAnalysis().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
