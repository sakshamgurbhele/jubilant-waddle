/**
 * scrape-linkedin.mjs
 * Scrapes LinkedIn job listings via Apify and appends new matches to data/pipeline.md
 *
 * Usage:
 *   node scrape-linkedin.mjs                    # paginated mode: start=75→990, last 24h
 *   node scrape-linkedin.mjs --mode keyword     # keyword search mode (all dates)
 *   node scrape-linkedin.mjs --dry-run          # preview matches without writing
 *   node scrape-linkedin.mjs --limit 500        # override max results
 *   node scrape-linkedin.mjs --start 75 --end 990 --step 10   # custom pagination range
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { isDuplicate, addToIndex, loadIndex } from './lib/semantic-dedup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const APIFY_TOKEN = (() => {
  try {
    const yaml = readFileSync(join(__dirname, 'config/profile.yml'), 'utf8');
    const match = yaml.match(/token:\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch { return null; }
})();

if (!APIFY_TOKEN) {
  console.error('❌ No Apify token found in config/profile.yml');
  process.exit(1);
}

const ACTOR_ID = 'curious_coder~linkedin-jobs-scraper';
const PIPELINE_PATH = join(__dirname, 'data/pipeline.md');

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const MODE     = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'paginate';
const MAX_RESULTS = (() => { const i = args.indexOf('--limit'); return i !== -1 ? parseInt(args[i+1]) : 1000; })();
const PAG_START   = (() => { const i = args.indexOf('--start'); return i !== -1 ? parseInt(args[i+1]) : 75; })();
const PAG_END     = (() => { const i = args.indexOf('--end');   return i !== -1 ? parseInt(args[i+1]) : 990; })();
const PAG_STEP    = (() => { const i = args.indexOf('--step');  return i !== -1 ? parseInt(args[i+1]) : 10; })();

// ── LinkedIn URL builders ─────────────────────────────────────────────────────

// geoId=103644278 = United States
// f_TPR=r86400    = last 24 hours
// f_TPR=r604800   = last 7 days
// sortBy=DD       = date descending

const BASE_KEYWORDS = [
  // Core AI Engineer titles
  'AI Engineer',
  'Senior AI Engineer',
  'Staff AI Engineer',
  'Principal AI Engineer',
  'AI Software Engineer',
  'AI Platform Engineer',
  'AI Infrastructure Engineer',
  'AI Research Engineer',
  'AI Systems Engineer',
  // LLM / GenAI
  'LLM Engineer',
  'Senior LLM Engineer',
  'LLMOps Engineer',
  'Generative AI Engineer',
  'GenAI Engineer',
  'Foundation Model Engineer',
  'Multimodal AI Engineer',
  'Applied AI Engineer',
  'Agentic AI Engineer',
  'AI Agent Engineer',
  // ML Engineer
  'ML Engineer',
  'Senior ML Engineer',
  'Staff ML Engineer',
  'Principal ML Engineer',
  'Applied ML Engineer',
  'Machine Learning Engineer',
  'Senior Machine Learning Engineer',
  'Staff Machine Learning Engineer',
  'Deep Learning Engineer',
  'MLOps Engineer',
  // NLP / Conversational
  'NLP Engineer',
  'Conversational AI Engineer',
  'Large Language Model Engineer',
  // RAG / Search AI
  'RAG Engineer',
  // Inference / Serving
  'ML Inference Engineer',
  'Model Serving Engineer',
  'AI Backend Engineer',
];

/**
 * Paginated mode: one URL per (keyword × start_offset)
 * Covers start=75 to 990 in steps of 10 — exactly the range the user wants.
 * f_TPR=r86400 → last 24 hours only.
 */
function buildPaginatedUrls() {
  const urls = [];
  for (const keyword of BASE_KEYWORDS) {
    for (let start = PAG_START; start <= PAG_END; start += PAG_STEP) {
      const params = new URLSearchParams({
        keywords: keyword,
        location: 'United States',
        geoId: '103644278',
        f_TPR: 'r86400',   // last 24 hours
        sortBy: 'DD',
        start: String(start),
      });
      urls.push(`https://www.linkedin.com/jobs/search/?${params.toString()}`);
    }
  }
  return urls;
}

/**
 * Keyword mode: one URL per keyword, no pagination offset, last 30 days.
 * Used for broad discovery sweeps.
 */
function buildKeywordUrls() {
  return BASE_KEYWORDS.map(keyword => {
    const params = new URLSearchParams({
      keywords: keyword,
      location: 'United States',
      geoId: '103644278',
      f_TPR: 'r2592000',  // last 30 days
      sortBy: 'DD',
    });
    return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
  });
}

// ── Filters ───────────────────────────────────────────────────────────────────

const TITLE_BLOCKLIST = [
  'intern', 'internship', 'co-op', 'coop', 'new grad', 'entry level',
  'junior', 'director', 'vp ', 'vice president', 'head of', 'manager',
  'principal scientist', 'data scientist', 'data analyst', 'data engineer',
  'frontend', 'front-end', 'android', 'ios', 'mobile', 'devops',
  'hardware', 'robotics', 'computer vision', 'autonomous driving',
];

const TITLE_ALLOWLIST = [
  'ai engineer', 'ml engineer', 'machine learning engineer', 'llm',
  'applied ai', 'generative ai', 'genai', 'ai platform', 'mlops',
  'llmops', 'ai/ml', 'ai software', 'ai research', 'staff ai',
  'agentic', 'large language',
];

function titleMatches(title) {
  const t = title.toLowerCase();
  if (TITLE_BLOCKLIST.some(b => t.includes(b))) return false;
  return TITLE_ALLOWLIST.some(a => t.includes(a));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apifyPost(path, body) {
  const res = await fetch(`https://api.apify.com/v2${path}?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Apify POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apifyGet(path) {
  const res = await fetch(`https://api.apify.com/v2${path}?token=${APIFY_TOKEN}`);
  if (!res.ok) throw new Error(`Apify GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

function getExistingUrls() {
  if (!existsSync(PIPELINE_PATH)) return new Set();
  const content = readFileSync(PIPELINE_PATH, 'utf8');
  const urls = new Set();
  for (const line of content.split('\n')) {
    const m = line.match(/https?:\/\/[^\s|)]+/);
    if (m) urls.add(m[0].trim());
  }
  return urls;
}

function formatPipelineLine(job) {
  const url     = (job.jobUrl || job.url || job.link || '').split('?')[0]; // strip tracking params
  const company = (job.companyName || job.company || 'Unknown').replace(/\|/g, '-');
  const title   = (job.title || job.jobTitle || 'Unknown').replace(/\|/g, '-');
  const location= (job.location || job.jobLocation || '').replace(/\|/g, '-');
  return `- [ ] ${url} | ${company} | ${title} | ${location}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runScrape() {
  const searchUrls = MODE === 'keyword' ? buildKeywordUrls() : buildPaginatedUrls();

  console.log(`🚀 LinkedIn scrape via Apify`);
  console.log(`   Mode: ${MODE === 'keyword' ? 'keyword (last 30 days)' : `paginate (start=${PAG_START}→${PAG_END} step ${PAG_STEP}, last 24h)`}`);
  console.log(`   Search URLs generated: ${searchUrls.length}`);
  console.log(`   Max results: ${MAX_RESULTS}`);
  if (DRY_RUN) console.log(`   ⚠ DRY RUN — no writes`);
  console.log('');

  // Apify actor: curious_coder/linkedin-jobs-scraper
  // Input: urls (flat string array), count (per URL, min 10)
  const countPerUrl = Math.max(10, Math.ceil(MAX_RESULTS / searchUrls.length));

  // Split into batches of 50 URLs to avoid actor timeout
  const BATCH_SIZE = 50;
  const batches = [];
  for (let i = 0; i < searchUrls.length; i += BATCH_SIZE) {
    batches.push(searchUrls.slice(i, i + BATCH_SIZE));
  }

  console.log(`   Batches: ${batches.length} × up to ${BATCH_SIZE} URLs`);
  console.log('');

  const allItems = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    console.log(`▶ Batch ${b + 1}/${batches.length} (${batch.length} URLs)...`);

    const input = { urls: batch, count: countPerUrl };

    let runData;
    try {
      runData = await apifyPost(`/acts/${ACTOR_ID}/runs`, input);
    } catch (err) {
      console.error(`   ❌ Actor failed: ${err.message}`);
      continue;
    }

    const runId = runData.data?.id;
    if (!runId) { console.error('   ❌ No run ID'); continue; }
    console.log(`   Run ID: ${runId}`);

    // Poll
    let status = 'RUNNING';
    let attempts = 0;
    while (['RUNNING', 'READY'].includes(status)) {
      await sleep(10000);
      attempts++;
      const poll = await apifyGet(`/actor-runs/${runId}`);
      status = poll.data?.status || 'UNKNOWN';
      const items = poll.data?.stats?.itemCount || 0;
      process.stdout.write(`\r   ${status} | ${items} items | ${attempts * 10}s   `);
    }
    console.log('');

    if (status !== 'SUCCEEDED') {
      console.warn(`   ⚠ Batch ended with status ${status} — skipping`);
      continue;
    }

    // Fetch dataset
    const datasetId = (await apifyGet(`/actor-runs/${runId}`)).data?.defaultDatasetId;
    const dataset = await apifyGet(`/datasets/${datasetId}/items?limit=${MAX_RESULTS}`);
    const items = Array.isArray(dataset) ? dataset : (dataset.items || []);
    console.log(`   ✅ ${items.length} items fetched`);
    allItems.push(...items);

    // Small pause between batches to be nice to Apify
    if (b < batches.length - 1) await sleep(3000);
  }

  console.log('');
  console.log(`📊 Total raw items: ${allItems.length}`);

  // Dedup by URL within this run
  const seenThisRun = new Set();
  const dedupedItems = allItems.filter(job => {
    const url = (job.jobUrl || job.url || job.link || '').split('?')[0];
    if (seenThisRun.has(url)) return false;
    seenThisRun.add(url);
    return true;
  });

  // Filter against existing pipeline
  const existingUrls = getExistingUrls();
  const filtered = dedupedItems.filter(job => {
    const url = (job.jobUrl || job.url || job.link || '').split('?')[0];
    const title = job.title || job.jobTitle || '';
    if (!url || !url.includes('linkedin.com')) return false;
    if (existingUrls.has(url)) return false;
    if (!titleMatches(title)) return false;
    return true;
  });

  console.log(`   After URL dedup + filter: ${filtered.length} candidates`);

  // Semantic dedup: remove jobs that are semantically similar to already-seen ones
  await loadIndex();
  const semanticFiltered = [];
  let semanticSkipped = 0;
  for (const job of filtered) {
    const jobObj = {
      company: job.companyName || job.company || 'Unknown',
      title:   job.title || job.jobTitle || 'Unknown',
      description: job.description || job.jobDescription || '',
    };
    if (await isDuplicate(jobObj, [])) {
      semanticSkipped++;
      continue;
    }
    await addToIndex(jobObj);
    semanticFiltered.push(job);
  }

  if (semanticSkipped > 0) {
    console.log(`   Semantic dedup: removed ${semanticSkipped} near-duplicate listings`);
  }
  console.log(`   After semantic dedup: ${semanticFiltered.length} new matches`);
  console.log('');

  const finalFiltered = semanticFiltered;

  if (finalFiltered.length === 0) {
    console.log('ℹ No new jobs to add. Pipeline is up to date.');
    return;
  }

  // Preview top 20
  console.log('📋 New jobs to add:');
  for (const job of finalFiltered.slice(0, 20)) {
    const title   = job.title || job.jobTitle || 'Unknown';
    const company = job.companyName || job.company || 'Unknown';
    const loc     = job.location || '';
    console.log(`   • ${company} — ${title} (${loc})`);
  }
  if (finalFiltered.length > 20) console.log(`   ... and ${finalFiltered.length - 20} more`);
  console.log('');

  if (DRY_RUN) {
    console.log('🔍 Dry run — no changes written.');
    return;
  }

  // Write to pipeline.md (insert before ## Processed)
  const lines   = finalFiltered.map(formatPipelineLine).join('\n');
  const current = readFileSync(PIPELINE_PATH, 'utf8');
  const updated = current.includes('## Processed')
    ? current.replace('## Processed', `${lines}\n\n## Processed`)
    : current.trimEnd() + '\n' + lines + '\n';

  writeFileSync(PIPELINE_PATH, updated, 'utf8');
  console.log(`✅ Added ${finalFiltered.length} new jobs to data/pipeline.md`);
  console.log('');
  console.log('Next: run /career-ops to evaluate the new batch.');
}

runScrape().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
