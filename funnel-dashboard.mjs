#!/usr/bin/env node
/**
 * funnel-dashboard.mjs
 * Generates a live HTML analytics dashboard from data/applications.md
 *
 * Usage:
 *   node funnel-dashboard.mjs        Generate and open dashboard/funnel.html
 *   node funnel-dashboard.mjs --no-open   Generate without opening browser
 *   node funnel-dashboard.mjs --help
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
funnel-dashboard.mjs — Generate analytics dashboard from applications

Usage:
  node funnel-dashboard.mjs           Generate and open dashboard/funnel.html
  node funnel-dashboard.mjs --no-open Generate without opening browser
  node funnel-dashboard.mjs --help    Show this help
`;

// ── Parse applications.md ─────────────────────────────────────────────────────

function parseApplications() {
  const appsPath = join(ROOT, 'data/applications.md');
  if (!existsSync(appsPath)) return [];

  const content = readFileSync(appsPath, 'utf8');
  const apps = [];

  for (const line of content.split('\n')) {
    if (!line.startsWith('|') || line.includes('---') || line.includes('Company') || line.includes('Role')) continue;

    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 7) continue;

    const num = parseInt(parts[1]);
    if (isNaN(num) || num === 0) continue;

    const dateStr = parts[2] || '';
    const company = parts[3] || '';
    const role    = parts[4] || '';
    const score   = parseFloat((parts[5] || '0').replace('/5', '')) || 0;
    const status  = parts[6] || '';
    const notes   = parts[9] || parts[8] || '';

    // Detect H1B status from notes
    let h1b = 'unknown';
    if (/h1b.*yes|sponsor.*yes|sponsors?/i.test(notes)) h1b = 'yes';
    else if (/no.*sponsor|sponsor.*no|no.*h1b/i.test(notes)) h1b = 'no';

    // Detect location
    let location = 'Unknown';
    const locMatch = role.match(/\(([^)]+)\)$/);
    if (locMatch) location = locMatch[1];
    else if (/remote/i.test(notes + role + company)) location = 'Remote';
    else if (/new\s*york|nyc/i.test(notes + role + company)) location = 'NYC';
    else if (/san\s*francisco|sf\b/i.test(notes + role + company)) location = 'SF';

    apps.push({ num, date: dateStr, company, role, score, status, h1b, location, notes });
  }

  return apps;
}

// ── Analytics calculations ────────────────────────────────────────────────────

function computeAnalytics(apps) {
  const total = apps.length;

  // Pipeline funnel
  const funnel = {
    Evaluated:  apps.filter(a => a.status !== 'SKIP').length,
    Applied:    apps.filter(a => ['Applied','Responded','Interview','Offer'].includes(a.status)).length,
    Responded:  apps.filter(a => ['Responded','Interview','Offer'].includes(a.status)).length,
    Interview:  apps.filter(a => ['Interview','Offer'].includes(a.status)).length,
    Offer:      apps.filter(a => a.status === 'Offer').length,
  };

  // Score distribution (buckets: 0-1, 1-2, 2-3, 3-4, 4-5)
  const scoreHist = [0, 0, 0, 0, 0];
  for (const a of apps) {
    const bucket = Math.min(Math.floor(a.score), 4);
    if (bucket >= 0) scoreHist[bucket]++;
  }

  // H1B breakdown
  const h1b = {
    yes:     apps.filter(a => a.h1b === 'yes').length,
    no:      apps.filter(a => a.h1b === 'no').length,
    unknown: apps.filter(a => a.h1b === 'unknown').length,
  };

  // Top companies by score
  const byCompany = {};
  for (const a of apps) {
    if (!byCompany[a.company]) byCompany[a.company] = { scores: [], status: a.status };
    byCompany[a.company].scores.push(a.score);
  }
  const topCompanies = Object.entries(byCompany)
    .map(([name, data]) => ({
      name,
      avgScore: data.scores.reduce((s, x) => s + x, 0) / data.scores.length,
      count: data.scores.length,
    }))
    .filter(c => c.avgScore > 0)
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 10);

  // Daily application rate (evaluations per day over last 30 days)
  const dailyCounts = {};
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const a of apps) {
    if (a.date >= thirtyDaysAgo) {
      dailyCounts[a.date] = (dailyCounts[a.date] || 0) + 1;
    }
  }
  const dailyData = Object.entries(dailyCounts).sort(([a], [b]) => a.localeCompare(b));

  // Location breakdown
  const locCounts = {};
  for (const a of apps) {
    locCounts[a.location] = (locCounts[a.location] || 0) + 1;
  }

  // Ready to apply (evaluated, score >= 4.0, not yet applied)
  const readyToApply = apps.filter(a =>
    a.score >= 4.0 &&
    a.status === 'Evaluated'
  ).length;

  // Status counts
  const statusCounts = {};
  for (const a of apps) {
    statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
  }

  return {
    total, funnel, scoreHist, h1b, topCompanies, dailyData, locCounts, readyToApply, statusCounts,
  };
}

// ── HTML generation ───────────────────────────────────────────────────────────

function generateHTML(analytics, apps) {
  const { total, funnel, scoreHist, h1b, topCompanies, dailyData, locCounts, readyToApply } = analytics;

  const convRate = (num, den) => den > 0 ? ((num / den) * 100).toFixed(1) + '%' : 'N/A';

  const dailyLabels = JSON.stringify(dailyData.map(([d]) => d));
  const dailyValues = JSON.stringify(dailyData.map(([, v]) => v));
  const topCoNames  = JSON.stringify(topCompanies.map(c => c.name));
  const topCoScores = JSON.stringify(topCompanies.map(c => +c.avgScore.toFixed(2)));
  const locLabels   = JSON.stringify(Object.keys(locCounts));
  const locValues   = JSON.stringify(Object.values(locCounts));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Career-Ops Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f1117; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; }
  header { background: #1a1d2e; border-bottom: 1px solid #2d3148; padding: 20px 32px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 1.4rem; font-weight: 700; color: #7c3aed; }
  header span { color: #94a3b8; font-size: 0.875rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; padding: 24px 32px; }
  .card { background: #1a1d2e; border: 1px solid #2d3148; border-radius: 12px; padding: 20px; }
  .card h2 { font-size: 0.75rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px; }
  .metric { font-size: 2.5rem; font-weight: 700; color: #e2e8f0; }
  .metric-label { font-size: 0.875rem; color: #64748b; margin-top: 4px; }
  .funnel-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #2d3148; }
  .funnel-row:last-child { border-bottom: none; }
  .funnel-stage { font-weight: 600; color: #e2e8f0; }
  .funnel-count { font-size: 1.25rem; font-weight: 700; color: #7c3aed; }
  .funnel-rate { font-size: 0.75rem; color: #64748b; }
  canvas { max-height: 220px; }
  .alert { background: #1e2a1e; border: 1px solid #16a34a; border-radius: 8px; padding: 14px 18px; margin: 0 32px 24px; color: #4ade80; font-size: 0.9rem; }
  .alert strong { color: #86efac; }
  .two-col { grid-column: span 2; }
  @media (max-width: 640px) { .two-col { grid-column: span 1; } .grid { padding: 16px; } }
</style>
</head>
<body>
<header>
  <h1>Career-Ops Dashboard</h1>
  <span>Generated ${new Date().toLocaleString()} &bull; ${total} total evaluations</span>
</header>

${readyToApply > 0 ? `<div class="alert"><strong>${readyToApply} jobs</strong> with score ≥ 4.0 and status "Evaluated" — ready to apply!</div>` : ''}

<div class="grid">

  <!-- KPI Cards -->
  <div class="card">
    <h2>Total Evaluated</h2>
    <div class="metric">${total}</div>
    <div class="metric-label">All time</div>
  </div>

  <div class="card">
    <h2>Applied</h2>
    <div class="metric">${funnel.Applied}</div>
    <div class="metric-label">${convRate(funnel.Applied, funnel.Evaluated)} of evaluated</div>
  </div>

  <div class="card">
    <h2>Interviews</h2>
    <div class="metric">${funnel.Interview}</div>
    <div class="metric-label">${convRate(funnel.Interview, funnel.Applied)} of applied</div>
  </div>

  <div class="card">
    <h2>Offers</h2>
    <div class="metric">${funnel.Offer}</div>
    <div class="metric-label">${convRate(funnel.Offer, funnel.Interview)} of interviews</div>
  </div>

  <!-- Pipeline Funnel -->
  <div class="card">
    <h2>Pipeline Funnel</h2>
    ${Object.entries(funnel).map(([stage, count], i, arr) => `
    <div class="funnel-row">
      <span class="funnel-stage">${stage}</span>
      <span>
        <span class="funnel-count">${count}</span>
        <span class="funnel-rate"> ${i > 0 ? convRate(count, arr[i-1][1]) : ''}</span>
      </span>
    </div>`).join('')}
  </div>

  <!-- Score Distribution -->
  <div class="card">
    <h2>Score Distribution</h2>
    <canvas id="scoreChart"></canvas>
  </div>

  <!-- H1B Breakdown -->
  <div class="card">
    <h2>H1B / Sponsorship</h2>
    <canvas id="h1bChart"></canvas>
  </div>

  <!-- Top Companies -->
  <div class="card">
    <h2>Top Companies by Score</h2>
    <canvas id="companyChart"></canvas>
  </div>

  <!-- Daily Rate -->
  <div class="card two-col">
    <h2>Daily Evaluation Rate (Last 30 Days)</h2>
    <canvas id="dailyChart"></canvas>
  </div>

  <!-- Location Heatmap -->
  <div class="card">
    <h2>Location Breakdown</h2>
    <canvas id="locChart"></canvas>
  </div>

</div>

<script>
const PURPLE = '#7c3aed';
const VIOLET = '#a855f7';
const GREEN  = '#16a34a';
const RED    = '#dc2626';
const GRAY   = '#475569';
const chartDefaults = {
  plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: '#64748b' }, grid: { color: '#2d3148' } },
    y: { ticks: { color: '#64748b' }, grid: { color: '#2d3148' } },
  },
};

// Score distribution
new Chart(document.getElementById('scoreChart'), {
  type: 'bar',
  data: {
    labels: ['0-1', '1-2', '2-3', '3-4', '4-5'],
    datasets: [{ label: 'Jobs', data: ${JSON.stringify(scoreHist)}, backgroundColor: [RED, RED, GRAY, VIOLET, PURPLE] }],
  },
  options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display: false } } },
});

// H1B pie
new Chart(document.getElementById('h1bChart'), {
  type: 'doughnut',
  data: {
    labels: ['Sponsors', 'No Sponsor', 'Unknown'],
    datasets: [{ data: [${h1b.yes}, ${h1b.no}, ${h1b.unknown}], backgroundColor: [GREEN, RED, GRAY] }],
  },
  options: { plugins: { legend: { labels: { color: '#94a3b8' } } } },
});

// Top companies
new Chart(document.getElementById('companyChart'), {
  type: 'bar',
  data: {
    labels: ${topCoNames},
    datasets: [{ label: 'Avg Score', data: ${topCoScores}, backgroundColor: PURPLE }],
  },
  options: {
    indexAxis: 'y',
    ...chartDefaults,
    scales: {
      x: { min: 0, max: 5, ticks: { color: '#64748b' }, grid: { color: '#2d3148' } },
      y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } },
    },
  },
});

// Daily evaluations
new Chart(document.getElementById('dailyChart'), {
  type: 'line',
  data: {
    labels: ${dailyLabels},
    datasets: [{ label: 'Evaluations', data: ${dailyValues}, borderColor: PURPLE, backgroundColor: 'rgba(124,58,237,0.1)', fill: true, tension: 0.3 }],
  },
  options: chartDefaults,
});

// Location
new Chart(document.getElementById('locChart'), {
  type: 'doughnut',
  data: {
    labels: ${locLabels},
    datasets: [{ data: ${locValues}, backgroundColor: ['#7c3aed','#a855f7','#6366f1','#475569','#1e293b'] }],
  },
  options: { plugins: { legend: { labels: { color: '#94a3b8' } } } },
});
</script>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const noOpen = args.includes('--no-open');

const apps = parseApplications();
console.log(`Loaded ${apps.length} applications`);

const analytics = computeAnalytics(apps);
const html = generateHTML(analytics, apps);

// Ensure dashboard/ directory exists
const dashDir = join(ROOT, 'dashboard');
if (!existsSync(dashDir)) mkdirSync(dashDir, { recursive: true });

const outputPath = join(dashDir, 'funnel.html');
writeFileSync(outputPath, html);
console.log(`Dashboard saved: ${outputPath}`);

// Summary stats
console.log('');
console.log(`Pipeline: ${analytics.funnel.Evaluated} evaluated → ${analytics.funnel.Applied} applied → ${analytics.funnel.Interview} interviews → ${analytics.funnel.Offer} offers`);
if (analytics.readyToApply > 0) {
  console.log(`Ready to apply: ${analytics.readyToApply} jobs (score >= 4.0, not yet applied)`);
}

// Open in browser
if (!noOpen) {
  const openCmd = process.platform === 'win32' ? `start "" "${outputPath}"` :
    process.platform === 'darwin' ? `open "${outputPath}"` : `xdg-open "${outputPath}"`;
  exec(openCmd, err => {
    if (err) console.log(`\nOpen manually: ${outputPath}`);
  });
}
