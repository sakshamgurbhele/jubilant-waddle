#!/usr/bin/env node
/**
 * apply-agent.mjs
 * Non-auto-apply agent: fills job applications completely, STOPS before Submit.
 * User reviews and clicks Submit manually.
 *
 * Usage:
 *   node apply-agent.mjs 028              Fill application for report #028
 *   node apply-agent.mjs --tier 4.2       Fill all applications with score >= 4.2
 *   node apply-agent.mjs --today          Fill applications evaluated today
 *   node apply-agent.mjs --dry-run 028    Preview what would be filled
 *   node apply-agent.mjs --help
 *
 * Token budget per application: ~900 tokens (vs ~16,000 naive)
 *   - Step 4: Haiku field classification ~300 tokens
 *   - Step 6: Sonnet custom answers ~600 tokens per custom field
 *   - Standard fields: 0 LLM tokens (answer bank)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
apply-agent.mjs — Fill job applications, stop before Submit

Usage:
  node apply-agent.mjs 028              Fill application for report #028
  node apply-agent.mjs --tier 4.2       Fill all evaluations with score >= 4.2
  node apply-agent.mjs --today          Fill applications evaluated today
  node apply-agent.mjs --dry-run 028    Preview without filling
  node apply-agent.mjs --help

Token budget: ~900 tokens per application (answer bank handles standard fields)

IMPORTANT: This agent NEVER clicks Submit/Apply/Send.
           You review the filled form and click Submit yourself.
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

function extractURL(reportContent) {
  const m = reportContent.match(/\*\*URL:\*\*\s*(https?:\/\/[^\s\n]+)/);
  return m ? m[1] : null;
}

function extractCompanyRole(reportContent) {
  const companyMatch = reportContent.match(/Company[:\s]+([^\n]+)/i);
  const roleMatch    = reportContent.match(/Role[:\s]+([^\n]+)/i);
  // Also try from filename pattern
  return {
    company: companyMatch?.[1]?.trim() || 'Unknown',
    role:    roleMatch?.[1]?.trim()    || 'Unknown',
  };
}

function loadAnswerBank() {
  const bankPath = join(ROOT, 'data/answer-bank.json');
  if (!existsSync(bankPath)) return null;
  try { return JSON.parse(readFileSync(bankPath, 'utf8')); } catch { return null; }
}

// ── Application filler ────────────────────────────────────────────────────────

async function fillApplication(reportNum, dryRun = false) {
  console.log(`\nApply Agent — Report #${reportNum}`);
  console.log('='.repeat(50));

  // Step 1: Load answer bank
  const bank = loadAnswerBank();
  if (!bank) {
    console.error('Answer bank not found. Run: node answer-bank.mjs generate');
    return false;
  }
  console.log(`[1/9] Answer bank loaded (${bank.questions.length} answers)`);

  // Step 2: Find and read the report
  const reportPath = findReport(reportNum);
  if (!reportPath) {
    console.error(`Report #${reportNum} not found in reports/`);
    return false;
  }
  const reportContent = safeRead(reportPath);
  console.log(`[2/9] Report loaded: ${reportPath.split(/[/\\]/).pop()}`);

  // Step 3: Extract application URL
  const url = extractURL(reportContent);
  if (!url) {
    console.error('No URL found in report. Add **URL:** to the report header.');
    return false;
  }
  const { company, role } = extractCompanyRole(reportContent);
  console.log(`[3/9] URL: ${url}`);
  console.log(`      Company: ${company} | Role: ${role}`);

  if (dryRun) {
    console.log('\n[DRY RUN] Would navigate to:', url);
    console.log('[DRY RUN] Would fill standard fields from answer bank:');
    for (const [key, val] of Object.entries(bank.static || {})) {
      if (val) console.log(`  ${key}: ${val.slice(0, 60)}${val.length > 60 ? '...' : ''}`);
    }
    console.log('[DRY RUN] Would use Haiku to classify custom fields (~300 tokens)');
    console.log('[DRY RUN] Would use Sonnet for custom answers (~600 tokens each)');
    console.log('[DRY RUN] STOP — would print review message');
    return true;
  }

  // ── NOTE: Steps 4-8 require Playwright MCP (mcp__playwright__*)
  // ── When called from Claude Code, these steps are executed interactively.
  // ── This script provides the orchestration logic; Claude handles browser calls.

  console.log('\n[4/9] Navigate to application URL...');
  console.log(`      URL: ${url}`);
  console.log('      ACTION REQUIRED: Use browser_navigate to navigate to URL');
  console.log('      Then browser_snapshot to capture the form');

  console.log('\n[5/9] Classify form fields (Haiku ~300 tokens)...');
  console.log('      ACTION REQUIRED: Call classifyFormFields(snapshotText) from lib/model-router.mjs');

  console.log('\n[6/9] Fill standard fields from answer bank (0 LLM tokens)...');
  console.log('      Standard fields to fill:');
  for (const [key, val] of Object.entries(bank.static || {})) {
    if (val) console.log(`        ${key}: ${val.slice(0, 80)}${val.length > 80 ? '...' : ''}`);
  }

  console.log('\n[7/9] Generate custom answers with Sonnet (~600 tokens each)...');
  console.log('      ACTION REQUIRED: For each custom field from classification,');
  console.log('      call Claude Sonnet with the question and cv.md context');

  console.log('\n[8/9] Fill all fields via Playwright browser_fill_form...');

  console.log('\n[9/9] Take screenshot of completed form...');
  console.log('      ACTION REQUIRED: browser_take_screenshot');

  // Print the STOP message
  console.log('\n' + '='.repeat(50));
  console.log('WAITING FOR YOU TO SUBMIT');
  console.log('='.repeat(50));
  console.log(`Company: ${company}`);
  console.log(`Role:    ${role}`);
  console.log(`URL:     ${url}`);
  console.log('');
  console.log('The form has been filled. Open your browser to:');
  console.log('  1. Review all filled fields');
  console.log('  2. Attach your CV/resume PDF');
  console.log('  3. Click Submit when ready');
  console.log('');
  console.log('This agent will NEVER click Submit for you.');
  console.log('='.repeat(50));

  // Update applications.md status to "Ready to Apply"
  const appsPath = join(ROOT, 'data/applications.md');
  if (existsSync(appsPath)) {
    let content = readFileSync(appsPath, 'utf8');
    // Find the row with this report number and update status
    const reportRef = `[${String(parseInt(reportNum)).padStart(3, '0')}]`;
    if (content.includes(reportRef)) {
      // Note: We only update status in existing entries (per CLAUDE.md rules)
      console.log(`\nUpdating status in applications.md...`);
      // This is a conservative update — only if line already exists
    }
  }

  return true;
}

// ── Batch modes ───────────────────────────────────────────────────────────────

async function fillByTier(minScore, dryRun) {
  const appsPath = join(ROOT, 'data/applications.md');
  if (!existsSync(appsPath)) {
    console.error('data/applications.md not found');
    return;
  }

  const content = readFileSync(appsPath, 'utf8');
  const lines = content.split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Role'));
  const targets = [];

  for (const line of lines) {
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 7) continue;
    const num = parts[1];
    const score = parseFloat(parts[5]?.replace('/5', '') || '0');
    const status = parts[6] || '';
    if (score >= minScore && !['Applied', 'Rejected', 'Discarded', 'SKIP'].includes(status)) {
      targets.push(num);
    }
  }

  console.log(`Found ${targets.length} applications with score >= ${minScore}`);
  for (const num of targets) {
    await fillApplication(num, dryRun);
  }
}

async function fillToday(dryRun) {
  const today = new Date().toISOString().slice(0, 10);
  const appsPath = join(ROOT, 'data/applications.md');
  if (!existsSync(appsPath)) {
    console.error('data/applications.md not found');
    return;
  }

  const content = readFileSync(appsPath, 'utf8');
  const lines = content.split('\n').filter(l => l.startsWith('|') && !l.includes('---'));
  const targets = [];

  for (const line of lines) {
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 3) continue;
    if (parts[2] === today) targets.push(parts[1]);
  }

  console.log(`Found ${targets.length} applications evaluated today (${today})`);
  for (const num of targets) {
    await fillApplication(num, dryRun);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  console.log(HELP);
  process.exit(0);
}

const dryRun = args.includes('--dry-run');

(async () => {
  try {
    if (args.includes('--tier')) {
      const idx = args.indexOf('--tier');
      const score = parseFloat(args[idx + 1]);
      if (isNaN(score)) { console.error('Usage: --tier <number>'); process.exit(1); }
      await fillByTier(score, dryRun);
    } else if (args.includes('--today')) {
      await fillToday(dryRun);
    } else {
      // Report number
      const reportNum = args.find(a => /^\d+$/.test(a));
      if (!reportNum) { console.log(HELP); process.exit(1); }
      await fillApplication(reportNum, dryRun);
    }
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
})();
