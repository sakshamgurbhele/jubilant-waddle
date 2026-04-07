#!/usr/bin/env node
/**
 * answer-bank.mjs
 * Pre-generates reusable answers for standard job application questions.
 * Eliminates 94% of LLM tokens in the apply workflow by caching polished answers.
 *
 * Usage:
 *   node answer-bank.mjs generate          # Generate/refresh answer bank
 *   node answer-bank.mjs lookup "question" # Find best answer for a question
 *   node answer-bank.mjs --help
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const ANSWER_BANK_PATH = join(ROOT, 'data/answer-bank.json');
const CV_PATH = join(ROOT, 'cv.md');
const PROFILE_PATH = join(ROOT, 'config/profile.yml');

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
answer-bank.mjs — Pre-generate reusable application answers

Usage:
  node answer-bank.mjs generate          Generate or refresh the answer bank
  node answer-bank.mjs lookup "question" Find the best pre-built answer
  node answer-bank.mjs --help            Show this help

The answer bank is saved to data/answer-bank.json and used by apply-agent.mjs
to fill standard application questions without calling Claude each time.

Requires: ANTHROPIC_API_KEY environment variable
`;

// ── Standard questions to pre-generate ────────────────────────────────────────

const STANDARD_QUESTIONS = [
  { id: 'tell_me_about_yourself',    pattern: 'tell me about yourself',       prompt: 'Write a 3-sentence professional summary for job applications. Lead with role/years, mention key specialization, end with what you are seeking.' },
  { id: 'why_this_company',          pattern: 'why do you want to work',       prompt: 'Write a template answer for "Why do you want to work at COMPANY_NAME?" Use [COMPANY_NAME] and [PRODUCT_NAME] as placeholders. 3 sentences: specific product/mission hook, your relevant background, what you will contribute.' },
  { id: 'greatest_achievement',      pattern: 'greatest achievement',          prompt: 'Describe your greatest professional achievement using STAR+R format (Situation, Task, Action, Result, Reflection). 4-5 sentences, lead with the measurable result.' },
  { id: 'biggest_challenge',         pattern: 'biggest challenge overcome',    prompt: 'Describe a significant technical or team challenge you overcame. 4 sentences: what it was, why it was hard, what you did, what you learned.' },
  { id: 'leadership_style',          pattern: 'describe your leadership style', prompt: 'Describe your leadership style in 3-4 sentences. Be specific with one concrete example.' },
  { id: 'why_leaving',               pattern: 'why are you leaving',           prompt: 'Write a positive, forward-looking answer for why you are leaving your current role. 2 sentences. Do not criticize current employer.' },
  { id: 'salary_expectations',       pattern: 'salary expectations',           prompt: 'Write a professional answer for salary expectations that defers to market rate and asks for their range first. 2 sentences.' },
  { id: 'start_date',                pattern: 'available start date',          prompt: 'Write a brief professional answer about start date availability. Mention standard 2-week notice and flexibility.' },
  { id: 'experience_llms',           pattern: 'experience with llm',           prompt: 'Describe your hands-on experience with Large Language Models. Include: specific models worked with, use cases built, measurable results. 4-5 sentences.' },
  { id: 'experience_ml',             pattern: 'experience with machine learning', prompt: 'Describe your ML engineering experience. Include: frameworks, scale of systems, types of models, production experience. 4-5 sentences.' },
  { id: 'experience_python',         pattern: 'experience with python',        prompt: 'Describe your Python experience in the context of AI/ML engineering. Include years, key libraries, scale. 3 sentences.' },
  { id: 'experience_aws',            pattern: 'experience with aws',           prompt: 'Describe your AWS/cloud infrastructure experience for ML workloads. Services used, scale, any certifications. 3 sentences.' },
  { id: 'team_size_preference',      pattern: 'team size preference',          prompt: 'Answer a question about preferred team size. Show adaptability while expressing genuine preference. 2 sentences.' },
  { id: 'remote_onsite_preference',  pattern: 'remote or onsite preference',   prompt: 'Answer a question about remote vs onsite preference professionally. 2 sentences, express flexibility.' },
  { id: 'what_makes_you_unique',     pattern: 'what makes you unique',         prompt: 'Answer "What makes you unique as a candidate?" in 3-4 sentences. Be specific and quantified, not generic.' },
  { id: 'career_goals_5_years',      pattern: 'career goals 5 years',          prompt: 'Answer the 5-year career goals question. Show ambition aligned with the role type (AI/ML engineering). 3 sentences.' },
  { id: 'describe_a_failure',        pattern: 'describe a failure',            prompt: 'Describe a professional failure and what you learned. STAR format. 4 sentences. End on growth.' },
  { id: 'conflict_resolution',       pattern: 'conflict resolution',           prompt: 'Describe how you handle team conflict or technical disagreements. Give one concrete example. 4 sentences.' },
  { id: 'project_most_proud',        pattern: 'project you are most proud of', prompt: 'Describe the project you are most proud of. Include: what you built, technical challenges, impact, why it matters to you. 5 sentences.' },
  { id: 'explain_technical',         pattern: 'explain technical concept',     prompt: 'Describe how you explain complex technical concepts to non-technical stakeholders. Give one example. 3-4 sentences.' },
  { id: 'agile_scrum',               pattern: 'agile scrum experience',        prompt: 'Describe your experience with agile/scrum methodology in AI/ML projects. 3 sentences: team setup, cadence, how it helped delivery.' },
  { id: 'open_source',               pattern: 'open source contributions',     prompt: 'Describe your open source contributions or public technical work (GitHub, papers, blog posts). 3 sentences. If limited, frame positively.' },
  { id: 'publications_patents',      pattern: 'publications or patents',       prompt: 'Answer a question about publications, patents, or technical writing. Be honest about scope. 2-3 sentences.' },
  { id: 'questions_for_interviewer', pattern: 'questions for us',              prompt: 'Generate 5 thoughtful questions to ask an interviewer at an AI company. Focus on: technical direction, team culture, success metrics, growth, and one strategic question.' },
  { id: 'cover_letter_template',     pattern: 'cover letter',                  prompt: 'Write a cover letter template for AI/ML engineering roles. Use [COMPANY_NAME], [ROLE_TITLE], [SPECIFIC_PRODUCT] as placeholders. 4 paragraphs: hook, fit, contribution, close. Professional but human tone.' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeRead(p) {
  try { return existsSync(p) ? readFileSync(p, 'utf8') : ''; } catch { return ''; }
}

/**
 * Simple keyword-based question matching.
 * @param {string} questionText
 * @returns {Object|null} Best matching answer entry
 */
export function lookup(questionText) {
  if (!existsSync(ANSWER_BANK_PATH)) return null;
  const bank = JSON.parse(readFileSync(ANSWER_BANK_PATH, 'utf8'));
  const q = questionText.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const entry of bank.questions || []) {
    const pattern = entry.pattern.toLowerCase();
    // Score by word overlap
    const patternWords = pattern.split(/\s+/);
    const matches = patternWords.filter(w => q.includes(w)).length;
    const score = matches / patternWords.length;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return bestScore > 0.4 ? best : null;
}

// ── Generate ──────────────────────────────────────────────────────────────────

async function generate() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  const cv = safeRead(CV_PATH);
  const profile = safeRead(PROFILE_PATH);

  if (!cv) {
    console.error('Error: cv.md not found. Run onboarding first.');
    process.exit(1);
  }

  // Extract static data from profile.yml
  const linkedinMatch = profile.match(/linkedin:\s*"?([^"\n]+)"?/i);
  const githubMatch   = profile.match(/github:\s*"?([^"\n]+)"?/i);
  const portfolioMatch = profile.match(/portfolio:\s*"?([^"\n]+)"?/i);
  const emailMatch    = profile.match(/email:\s*"?([^"\n]+)"?/i);

  const staticData = {
    linkedin:  linkedinMatch?.[1]?.trim()  || '',
    github:    githubMatch?.[1]?.trim()    || '',
    portfolio: portfolioMatch?.[1]?.trim() || '',
    email:     emailMatch?.[1]?.trim()     || '',
    authorized_to_work: 'Yes, I am authorized to work in the US',
    requires_sponsorship: 'Yes, I require H1B visa sponsorship',
    years_experience: '',
  };

  // Try to extract years of experience from CV
  const yearsMatch = cv.match(/(\d+)\+?\s+years?\s+(?:of\s+)?(?:experience|working)/i);
  if (yearsMatch) staticData.years_experience = `${yearsMatch[1]}+`;

  console.log('Generating answer bank...');
  console.log(`CV length: ${cv.length} chars`);
  console.log(`Questions to generate: ${STANDARD_QUESTIONS.length}`);
  console.log('');

  const client = new Anthropic({ apiKey });
  const questions = [];

  const systemPrompt = `You are a professional job application writer. You have access to this candidate's CV and profile.

CV:
${cv.slice(0, 4000)}

Profile context:
${profile.slice(0, 1000)}

Generate concise, specific, honest answers based ONLY on the information in the CV above.
Never invent metrics or experience. Be direct. No corporate buzzwords.
Write in first person. Use active voice.`;

  for (let i = 0; i < STANDARD_QUESTIONS.length; i++) {
    const q = STANDARD_QUESTIONS[i];
    process.stdout.write(`  [${i + 1}/${STANDARD_QUESTIONS.length}] ${q.id}... `);

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: q.prompt }],
      });

      const answer = response.content[0].text.trim();
      // Extract variables (placeholders like [COMPANY_NAME])
      const variables = [...answer.matchAll(/\[([A-Z_]+)\]/g)].map(m => m[1]);

      questions.push({
        id: q.id,
        pattern: q.pattern,
        answer_template: answer,
        variables: [...new Set(variables)],
      });

      process.stdout.write('done\n');
    } catch (err) {
      process.stdout.write(`ERROR: ${err.message}\n`);
      questions.push({
        id: q.id,
        pattern: q.pattern,
        answer_template: `[Could not generate — ${err.message}]`,
        variables: [],
      });
    }
  }

  const bank = {
    generated_at: new Date().toISOString(),
    questions,
    static: staticData,
  };

  writeFileSync(ANSWER_BANK_PATH, JSON.stringify(bank, null, 2));
  console.log('');
  console.log(`Answer bank saved to data/answer-bank.json`);
  console.log(`  ${questions.length} questions generated`);
  console.log(`  Static fields: ${Object.keys(staticData).join(', ')}`);
}

// ── Lookup CLI ─────────────────────────────────────────────────────────────────

function lookupCLI(questionText) {
  const result = lookup(questionText);
  if (!result) {
    console.log('No matching answer found in bank.');
    console.log('Run: node answer-bank.mjs generate');
    return;
  }
  console.log(`Match: "${result.pattern}"`);
  console.log('');
  console.log(result.answer_template);
  if (result.variables.length > 0) {
    console.log('');
    console.log(`Variables to fill: ${result.variables.join(', ')}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const command = args[0];

if (command === 'generate') {
  generate().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
} else if (command === 'lookup') {
  const question = args.slice(1).join(' ');
  if (!question) {
    console.error('Usage: node answer-bank.mjs lookup "your question here"');
    process.exit(1);
  }
  lookupCLI(question);
} else {
  console.log(HELP);
  process.exit(command ? 1 : 0);
}
