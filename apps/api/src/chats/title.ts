/**
 * Chat title generation (#78) — pure logic.
 *
 * The thin-client cutover (#63) dropped the LangGraph route's title generator,
 * so every chat stayed "New chat". A cheap post-turn model call now names the
 * chat from the user's message; TitleService orchestrates, this module decides.
 *
 * Prompt shape follows the Vercel ai-chatbot reference (lib/ai/prompts.ts
 * titlePrompt): a strict 2–5 word title, no prefixes/formatting, with examples —
 * plus the same output sanitation for models that add quotes or markdown anyway.
 */

export const TITLE_SYSTEM_PROMPT = `Generate a short chat title (2-5 words) summarizing the user's message.

Output ONLY the title text. No prefixes, no formatting.

Examples:
- "what's the weather in nyc" → Weather in NYC
- "help me write an essay about space" → Space Essay Help
- "hi" → New Conversation
- "debug my python code" → Python Debugging

Never output hashtags, prefixes like "Title:", or quotes.`;

/** Hard cap on persisted title length — the sidebar is not a paragraph. */
export const MAX_TITLE_LENGTH = 80;

/**
 * Normalize raw model output into a persistable title: strip leading markdown /
 * quote artifacts and a "Title:" prefix, collapse whitespace, clamp length.
 * Returns an empty string when nothing usable remains (caller skips the update).
 */
export function sanitizeTitle(raw: string): string {
  const cleaned = raw
    .replace(/^\s*title\s*:\s*/i, '')
    .replace(/^[#*"'\s]+/, '')
    .replace(/[#*"'\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.slice(0, MAX_TITLE_LENGTH).trim();
}
