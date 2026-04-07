/**
 * lib/cache-manager.mjs
 * Anthropic prompt caching utilities.
 * Marks large static system context blocks with cache_control: {type: "ephemeral"}
 * so they are cached across calls within a session, reducing token costs by ~40%.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Session-level cache stats
const _stats = {
  cache_hits: 0,
  cache_misses: 0,
  tokens_saved: 0,
};

/**
 * Read a file if it exists, otherwise return empty string.
 */
function safeRead(filePath) {
  try {
    if (existsSync(filePath)) return readFileSync(filePath, 'utf8');
  } catch { /* ignore */ }
  return '';
}

/**
 * Build a cached system prompt from the shared profile context.
 * The large static block (profile + archetypes + scoring rules) is marked
 * with cache_control: {type: "ephemeral"} so Anthropic caches it.
 *
 * Returns an array of content blocks suitable for the `system` field
 * in the Anthropic messages API.
 *
 * @param {string} [profileContent]  - Override for profile content (optional)
 * @param {string} [sharedContent]   - Override for shared content (optional)
 * @returns {Array} System content blocks with cache_control markers
 */
export function buildCachedSystemPrompt(profileContent, sharedContent) {
  const shared  = sharedContent  ?? safeRead(join(ROOT, 'modes/_shared.md'));
  const profile = profileContent ?? safeRead(join(ROOT, 'modes/_profile.md'));
  const profileYml = safeRead(join(ROOT, 'config/profile.yml'));

  // Build the large static context block
  const staticContext = [
    shared  ? `## Shared System Context\n${shared}`  : '',
    profile ? `## User Profile\n${profile}` : '',
    profileYml ? `## Profile Config (YAML)\n\`\`\`yaml\n${profileYml}\n\`\`\`` : '',
  ].filter(Boolean).join('\n\n---\n\n');

  // The cached block should be as large as possible to maximize cache hits.
  // Anthropic caches blocks at the boundary where cache_control appears.
  return [
    {
      type: 'text',
      text: staticContext,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

/**
 * Create an Anthropic client instance.
 */
export function createClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable not set');
  return new Anthropic({ apiKey });
}

/**
 * Send a cached message to the Anthropic API.
 * Automatically updates cache stats from the response usage.
 *
 * @param {Object} params
 * @param {string} params.model
 * @param {Array}  params.systemBlocks - from buildCachedSystemPrompt()
 * @param {Array}  params.messages     - user/assistant turn array
 * @param {number} [params.maxTokens]
 * @returns {Promise<Object>} Anthropic message response
 */
export async function cachedMessage({ model, systemBlocks, messages, maxTokens = 4096 }) {
  const client = createClient();

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages,
  });

  // Track cache stats from response usage
  const usage = response.usage || {};
  if (usage.cache_read_input_tokens > 0) {
    _stats.cache_hits++;
    // Cache hits cost 10% of normal input tokens
    _stats.tokens_saved += Math.floor(usage.cache_read_input_tokens * 0.9);
  } else {
    _stats.cache_misses++;
  }

  return response;
}

/**
 * Get cumulative cache stats for this session.
 * @returns {{cache_hits: number, cache_misses: number, tokens_saved: number}}
 */
export function getCacheStats() {
  return { ..._stats };
}
