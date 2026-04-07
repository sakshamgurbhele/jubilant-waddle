/**
 * lib/model-router.mjs
 * Three-tier model routing for cost-optimized evaluations.
 *
 * Tier 1 — Haiku:  hard-skip detection (cheap, ~380 tokens)
 * Tier 2 — Sonnet: standard 6-block evaluation (most jobs)
 * Tier 3 — Opus:   deep evaluation for top-tier companies at high scores
 */

// Model IDs
export const MODELS = {
  HAIKU:  'claude-haiku-4-5',
  SONNET: 'claude-sonnet-4-5',
  OPUS:   'claude-opus-4-5',
};

// Per-model token costs (USD per 1M tokens, as of early 2025)
export const TOKEN_COSTS = {
  [MODELS.HAIKU]: {
    input:              0.80,
    output:             4.00,
    cache_write:        1.00,
    cache_read:         0.08,
  },
  [MODELS.SONNET]: {
    input:              3.00,
    output:            15.00,
    cache_write:        3.75,
    cache_read:         0.30,
  },
  [MODELS.OPUS]: {
    input:             15.00,
    output:            75.00,
    cache_write:       18.75,
    cache_read:         1.50,
  },
};

// Tier 1 companies that warrant Opus evaluation when score >= 4.3
const TIER1_COMPANIES = new Set([
  'anthropic', 'openai', 'google deepmind', 'deepmind', 'google brain',
  'meta ai', 'meta', 'perplexity', 'mistral', 'cohere', 'inflection',
  'xai', 'x.ai', 'character.ai', 'adept', 'stability ai',
  'hugging face', 'huggingface', 'scale ai', 'together ai',
  'databricks', 'nvidia', 'microsoft research',
]);

// Staffing agency signals
const STAFFING_PATTERNS = [
  /\bit\s+staffing\b/i,
  /\bconsulting\s+firm\b/i,
  /\bw2\s+contract\b/i,
  /\bc2c\s+only\b/i,
  /\bc2c\/w2\b/i,
  /\bstaff(?:ing)?\s+agenc/i,
  /\bcontract(?:ing)?\s+agenc/i,
  /\bour\s+client\b/i,            // "on behalf of our client"
  /\bconfidential\s+client\b/i,
];

// Hard-skip patterns for Haiku
const HARD_SKIP_PATTERNS = [
  { pattern: /no[.\s]+(?:visa\s+)?sponsor/i,      reason: 'No sponsorship' },
  { pattern: /(?:us|u\.s\.)?\s*citizen(?:ship)?\s+(?:only|required)/i, reason: 'Citizens only' },
  { pattern: /security\s+clearance\s+required/i,  reason: 'Security clearance required' },
  { pattern: /must\s+hold\s+(?:active\s+)?clearance/i, reason: 'Clearance required' },
  { pattern: /top\s*secret\s*clearance/i,          reason: 'Top secret clearance' },
];

// Location-only block patterns (EU/India with no remote)
const LOCATION_BLOCK_PATTERNS = [
  /(?:based\s+in|located\s+in|work\s+from)\s+(?:india|bangalore|hyderabad|pune|chennai|mumbai)/i,
  /(?:eu|europe)(?:\s+only|\s+based|\s+candidates)/i,
];

/**
 * Parse a salary number from JD text.
 * Returns null if no salary found or unparseable.
 * @param {string} jdText
 * @returns {number|null} Annual salary in USD
 */
function parseSalary(jdText) {
  // Match patterns like "$120,000", "$120K", "120k", "120,000 - 150,000"
  const patterns = [
    /\$\s*(\d{2,3})[,.]?(\d{3})?\s*(?:\/\s*(?:yr|year|annual))?/gi,
    /\$\s*(\d{2,3})k\b/gi,
    /(\d{2,3})[,.]?(\d{3})?\s*(?:USD|dollars?)\s*(?:per\s+year|annually|\/yr)?/gi,
  ];

  let lowestFound = null;

  for (const re of patterns) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(jdText)) !== null) {
      let val;
      if (m[0].toLowerCase().includes('k')) {
        val = parseInt(m[1]) * 1000;
      } else if (m[2]) {
        val = parseInt(m[1] + m[2]);
      } else {
        val = parseInt(m[1]) * (parseInt(m[1]) < 1000 ? 1000 : 1);
      }
      if (val > 20000 && val < 2000000) {
        if (lowestFound === null || val < lowestFound) lowestFound = val;
      }
    }
  }
  return lowestFound;
}

/**
 * Route an evaluation to the appropriate model tier.
 *
 * @param {Object} jobData
 * @param {string} jobData.title       - Job title
 * @param {string} jobData.company     - Company name
 * @param {string} [jobData.jdText]    - Full JD text (optional)
 * @param {number} [jobData.score]     - Pre-computed score (optional, for Opus routing)
 * @returns {{model: string, tier: number, reason: string, estimated_tokens: number, skip: boolean, skipReason?: string}}
 */
export function routeEvaluation(jobData) {
  const { title = '', company = '', jdText = '', score = null } = jobData;
  const text = `${title} ${company} ${jdText}`.toLowerCase();
  const fullText = `${title} ${company} ${jdText}`;

  // ── Tier 1: Hard-skip detection (Haiku) ──────────────────────────────────────

  // Sponsorship / clearance blockers
  for (const { pattern, reason } of HARD_SKIP_PATTERNS) {
    if (pattern.test(fullText)) {
      return {
        model: MODELS.HAIKU,
        tier: 1,
        reason: `Hard skip: ${reason}`,
        estimated_tokens: 380,
        skip: true,
        skipReason: reason,
      };
    }
  }

  // Salary below $120K (if parseable)
  const salary = parseSalary(jdText);
  if (salary !== null && salary < 120000) {
    return {
      model: MODELS.HAIKU,
      tier: 1,
      reason: `Hard skip: Salary too low ($${(salary / 1000).toFixed(0)}K < $120K)`,
      estimated_tokens: 380,
      skip: true,
      skipReason: `Salary $${(salary / 1000).toFixed(0)}K below threshold`,
    };
  }

  // Location-only blocks (no remote)
  const hasRemote = /\bremote\b/i.test(jdText);
  if (!hasRemote) {
    for (const pattern of LOCATION_BLOCK_PATTERNS) {
      if (pattern.test(jdText)) {
        return {
          model: MODELS.HAIKU,
          tier: 1,
          reason: 'Hard skip: Location-restricted (no remote)',
          estimated_tokens: 380,
          skip: true,
          skipReason: 'Location restricted, no remote option',
        };
      }
    }
  }

  // Staffing agency postings
  if (STAFFING_PATTERNS.some(p => p.test(jdText))) {
    return {
      model: MODELS.HAIKU,
      tier: 1,
      reason: 'Hard skip: Staffing agency posting',
      estimated_tokens: 380,
      skip: true,
      skipReason: 'Staffing agency / unnamed client posting',
    };
  }

  // ── Tier 3: Opus for top-tier companies at high scores ────────────────────────

  const companyNorm = company.toLowerCase().trim();
  const isTier1 = TIER1_COMPANIES.has(companyNorm) ||
    [...TIER1_COMPANIES].some(t => companyNorm.includes(t));

  if (score !== null && score >= 4.3 && isTier1) {
    return {
      model: MODELS.OPUS,
      tier: 3,
      reason: `Top-tier company (${company}) + high score (${score})`,
      estimated_tokens: 12000,
      skip: false,
    };
  }

  // ── Tier 2: Standard Sonnet evaluation ───────────────────────────────────────

  return {
    model: MODELS.SONNET,
    tier: 2,
    reason: 'Standard evaluation',
    estimated_tokens: 2100,
    skip: false,
  };
}

/**
 * Classify application form fields using Haiku (cheap).
 * Returns categorized field list.
 *
 * @param {string} snapshotText - Playwright browser_snapshot text
 * @param {Object} [client]     - Anthropic client (optional, creates one if not provided)
 * @returns {Promise<{standard: string[], custom: string[], upload: string[], skip: string[]}>}
 */
export async function classifyFormFields(snapshotText, client = null) {
  const { createClient } = await import('./cache-manager.mjs');
  const anthropic = client || createClient();

  const response = await anthropic.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: `You are analyzing a job application form. Classify each visible form field into one of these categories:
- standard: name, email, phone, address, LinkedIn, GitHub, portfolio URL, resume/CV upload, years of experience, education level
- custom: open-ended questions, "why this company", "describe your experience with X", essay fields
- upload: file upload fields (cover letter, resume, portfolio)
- skip: CAPTCHA, checkboxes for terms/privacy, hidden fields, already-filled fields

Snapshot of the form:
${snapshotText.slice(0, 3000)}

Respond with JSON only:
{"standard": ["field label 1", ...], "custom": ["question text 1", ...], "upload": ["field label 1", ...], "skip": ["field label 1", ...]}`,
      },
    ],
  });

  try {
    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fall through */ }

  return { standard: [], custom: [], upload: [], skip: [] };
}

/**
 * Calculate the estimated cost for a given token count and model.
 * @param {string} model
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} Cost in USD
 */
export function estimateCost(model, inputTokens, outputTokens) {
  const costs = TOKEN_COSTS[model] || TOKEN_COSTS[MODELS.SONNET];
  return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
}
