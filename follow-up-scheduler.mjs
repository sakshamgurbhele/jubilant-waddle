#!/usr/bin/env node
/**
 * follow-up-scheduler.mjs
 * Tracks application follow-ups and generates personalized follow-up messages.
 *
 * Usage:
 *   node follow-up-scheduler.mjs check          Show what needs follow-up today
 *   node follow-up-scheduler.mjs message 028    Generate follow-up for job #028
 *   node follow-up-scheduler.mjs done 028       Mark follow-up as sent
 *   node follow-up-scheduler.mjs --help
 *
 * Requires: ANTHROPIC_API_KEY (for message generation only)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const FOLLOWUPS_PATH = join(ROOT, 'data/follow-ups.json');
const APPS_PATH = join(ROOT, 'data/applications.md');

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
follow-up-scheduler.mjs — Track and generate application follow-ups

Usage:
  node follow-up-scheduler.mjs check          Show applications needing follow-up
  node follow-up-scheduler.mjs message 028    Generate follow-up message for #028
  node follow-up-scheduler.mjs done 028       Mark follow-up as sent for #028
  node follow-up-scheduler.mjs list           List all follow-up history
  node follow-up-scheduler.mjs --help

Follow-up schedule:
  Day 7:  Initial follow-up
  Day 14: Second follow-up
  Day 21: Suggest marking stale
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeRead(p) {
  try { return existsSync(p) ? readFileSync(p, 'utf8') : ''; } catch { return ''; }
}

function loadFollowups() {
  if (!existsSync(FOLLOWUPS_PATH)) return { followups: {} };
  try { return JSON.parse(readFileSync(FOLLOWUPS_PATH, 'utf8')); } catch { return { followups: {} }; }
}

function saveFollowups(data) {
  writeFileSync(FOLLOWUPS_PATH, JSON.stringify(data, null, 2));
}

function daysSince(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function findReport(numStr) {
  const reportsDir = join(ROOT, 'reports');
  if (!existsSync(reportsDir)) return null;
  const padded = String(parseInt(numStr)).padStart(3, '0');
  const files = readdirSync(reportsDir).filter(f => f.startsWith(padded + '-'));
  return files.length > 0 ? join(reportsDir, files[0]) : null;
}

// ── Parse applications.md ─────────────────────────────────────────────────────

function parseAppliedJobs() {
  const content = safeRead(APPS_PATH);
  if (!content) return [];
  const jobs = [];

  for (const line of content.split('\n')) {
    if (!line.startsWith('|') || line.includes('---') || line.includes('Company')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 7) continue;
    const num    = parseInt(parts[1]);
    const date   = parts[2];
    const company = parts[3];
    const role   = parts[4];
    const score  = parts[5];
    const status = parts[6];
    if (isNaN(num)) continue;
    if (['Applied', 'Responded'].includes(status)) {
      jobs.push({ num, date, company, role, score, status });
    }
  }
  return jobs;
}

// ── Check command ─────────────────────────────────────────────────────────────

function checkFollowups() {
  const jobs = parseAppliedJobs();
  const data = loadFollowups();

  if (jobs.length === 0) {
    console.log('No "Applied" or "Responded" applications found.');
    return;
  }

  console.log(`Checking ${jobs.length} applied applications...\n`);

  const today = new Date().toISOString().slice(0, 10);
  const needsFollowup = [];
  const upToDate = [];
  const stale = [];

  for (const job of jobs) {
    const days = daysSince(job.date);
    if (days === null) continue;

    const followupRecord = data.followups[job.num] || {};
    const sentCount = Object.values(followupRecord).filter(v => v.sent).length;

    if (days >= 21 && sentCount >= 2) {
      stale.push({ ...job, days });
    } else if (days >= 14 && sentCount < 2) {
      needsFollowup.push({ ...job, days, followupNum: 2 });
    } else if (days >= 7 && sentCount < 1) {
      needsFollowup.push({ ...job, days, followupNum: 1 });
    } else {
      upToDate.push({ ...job, days });
    }
  }

  if (needsFollowup.length > 0) {
    console.log(`NEEDS FOLLOW-UP (${needsFollowup.length}):`);
    for (const j of needsFollowup.sort((a, b) => b.days - a.days)) {
      console.log(`  #${String(j.num).padStart(3,'0')} ${j.company} — ${j.role}`);
      console.log(`       Applied ${j.days} days ago | Follow-up #${j.followupNum}`);
      console.log(`       Run: node follow-up-scheduler.mjs message ${j.num}`);
    }
    console.log('');
  }

  if (stale.length > 0) {
    console.log(`STALE — Consider marking closed (${stale.length}):`);
    for (const j of stale) {
      console.log(`  #${String(j.num).padStart(3,'0')} ${j.company} — ${j.role} (${j.days} days)`);
    }
    console.log('');
  }

  if (needsFollowup.length === 0 && stale.length === 0) {
    console.log('All applications are up to date. No follow-ups needed today.');
  }

  if (upToDate.length > 0) {
    console.log(`Up to date (${upToDate.length}): ${upToDate.map(j => j.company).join(', ')}`);
  }
}

// ── Message generation ────────────────────────────────────────────────────────

async function generateMessage(reportNum) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set — cannot generate message');
    process.exit(1);
  }

  // Find the job in applications.md
  const jobs = parseAppliedJobs();
  const num = parseInt(reportNum);
  const job = jobs.find(j => j.num === num);

  if (!job) {
    console.error(`Job #${reportNum} not found in Applied applications`);
    process.exit(1);
  }

  const data = loadFollowups();
  const followupRecord = data.followups[num] || {};
  const sentCount = Object.values(followupRecord).filter(v => v.sent).length;
  const followupNum = sentCount + 1;
  const days = daysSince(job.date);

  console.log(`Generating follow-up #${followupNum} for ${job.company}...`);

  // Load report for context
  const reportPath = findReport(reportNum);
  const reportContent = reportPath ? safeRead(reportPath) : '';

  // Load candidate profile
  const profile = safeRead(join(ROOT, 'config/profile.yml'));
  const nameMatch = profile.match(/name:\s*"?([^"\n]+)"?/i);
  const candidateName = nameMatch?.[1]?.trim() || 'the candidate';

  const client = new Anthropic({ apiKey });

  const promptContext = reportContent
    ? `Report context (first 800 chars):\n${reportContent.slice(0, 800)}`
    : `Company: ${job.company}\nRole: ${job.role}`;

  const followupType = followupNum === 1
    ? 'initial follow-up (7 days after application)'
    : followupNum === 2
    ? 'second follow-up (14 days after application)'
    : 'final check-in (21+ days, will mark stale if no response)';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Write a ${followupType} email for a job application.

${promptContext}

Candidate: ${candidateName}
Applied: ${days} days ago
Follow-up number: ${followupNum}

Rules:
- 3 sentences maximum
- Sentence 1: Reference your specific application (role + company)
- Sentence 2: One specific, genuine thing about the role/company that excites you
- Sentence 3: Clear, direct ask (status update / next steps)
- Professional but human tone — not robotic
- No fluff, no "I hope this email finds you well"
- End with your name

Generate the email body only (no subject line).`,
    }],
  });

  const message = response.content[0].text.trim();

  console.log('');
  console.log('─'.repeat(50));
  console.log(message);
  console.log('─'.repeat(50));
  console.log('');
  console.log(`Subject: Follow-up — ${job.role} application`);
  console.log('');
  console.log(`Run: node follow-up-scheduler.mjs done ${reportNum}   (after sending)`);
}

// ── Mark done ─────────────────────────────────────────────────────────────────

function markDone(reportNum) {
  const num = parseInt(reportNum);
  const data = loadFollowups();
  if (!data.followups[num]) data.followups[num] = {};

  const followupNum = Object.keys(data.followups[num]).length + 1;
  const today = new Date().toISOString().slice(0, 10);

  data.followups[num][`followup_${followupNum}`] = {
    sent: true,
    date: today,
    num: followupNum,
  };

  saveFollowups(data);
  console.log(`Marked follow-up #${followupNum} as sent for job #${String(num).padStart(3, '0')} (${today})`);
}

// ── List command ──────────────────────────────────────────────────────────────

function listFollowups() {
  const data = loadFollowups();
  const entries = Object.entries(data.followups);

  if (entries.length === 0) {
    console.log('No follow-up history found.');
    return;
  }

  console.log(`Follow-up history (${entries.length} applications):\n`);
  for (const [num, record] of entries) {
    const sent = Object.values(record).filter(v => v.sent);
    console.log(`  #${String(num).padStart(3, '0')}: ${sent.length} follow-ups sent`);
    for (const s of sent) {
      console.log(`    Follow-up #${s.num} — ${s.date}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  console.log(HELP);
  process.exit(0);
}

const command = args[0];

(async () => {
  try {
    switch (command) {
      case 'check':
        checkFollowups();
        break;
      case 'message': {
        const num = args[1];
        if (!num) { console.error('Usage: message <report-number>'); process.exit(1); }
        await generateMessage(num);
        break;
      }
      case 'done': {
        const num = args[1];
        if (!num) { console.error('Usage: done <report-number>'); process.exit(1); }
        markDone(num);
        break;
      }
      case 'list':
        listFollowups();
        break;
      default:
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
})();
