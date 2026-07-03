import { jsonSchema } from 'ai';

/**
 * Chat title generation (#78) — pure logic.
 *
 * The thin-client cutover (#63) dropped the LangGraph route's title generator,
 * so every chat stayed untitled. A cheap post-turn model call now names the
 * chat from the user's message; TitleService orchestrates, this module decides.
 *
 * The prompt restores the pre-cutover generator's (lib/services/chat/
 * title-generator.ts, removed in 02f15a5) — its multilingual examples make the
 * model title in the conversation's own language instead of defaulting to
 * English. The LangChain tool-call output is replaced with plain text, so the
 * sanitation below still guards against models that add quotes or markdown.
 */

export const TITLE_SYSTEM_PROMPT = `You are tasked with generating a concise, descriptive title for a conversation between a user and an AI assistant. The title should capture the main topic or purpose of the conversation.

Guidelines for title generation:
- Keep titles extremely short (ideally 2-5 words)
- Write the title in the same language as the conversation
- Focus on the main topic or goal of the conversation
- Use natural, readable language
- Avoid unnecessary articles (a, an, the) when possible
- Do not include quotes or special characters
- Capitalize important words

Examples of titles:
- 📉 Stock Market Trends
- 🍪 완벽한 초콜릿 칩 레시피
- 流媒体音乐的演变
- Советы по повышению производительности удаленной работы
- Künstliche Intelligenz im Gesundheitswesen
- 🎮 ビデオゲーム開発の洞察

Output ONLY the title text — no prefixes like "Title:", no quotes, no markdown.`;

/**
 * Schema for structured title generation — the pre-cutover generator forced a
 * generate_title tool call for exactly this reason: a schema-constrained output
 * can't ramble ("Sure! Here's a title: …") the way free text sometimes does.
 * Kept as plain JSON Schema (the AI SDK wraps it via jsonSchema()) — no zod
 * dependency in the api.
 */
/** Tool identity from the pre-cutover generator's generate_title tool. */
export const TITLE_SCHEMA_NAME = 'generate_title';
export const TITLE_SCHEMA_DESCRIPTION =
  'Generate a concise title for the conversation';

export interface GeneratedTitle {
  title: string;
}

/**
 * Typed schema handle: jsonSchema<T> binds the JSON Schema sent to the
 * provider to the TS type it produces, so generateObject results are typed
 * end-to-end (the SDK validates the tool-call input against this schema).
 */
export const TITLE_OBJECT_SCHEMA = jsonSchema<GeneratedTitle>({
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'The generated title for the conversation',
    },
  },
  required: ['title'],
  additionalProperties: false,
});

/**
 * Wraps the (already length-bounded) user text as tagged conversation data,
 * mirroring the pre-cutover generator's user prompt: the text is something to
 * title, not instructions to follow (SPEC §28.2 trust boundary).
 */
export function titleUserPrompt(boundedText: string): string {
  return `Based on the following conversation, generate a very short and descriptive title for:

<user>
${boundedText}
</user>`;
}

/** Hard cap on persisted title length — the sidebar is not a paragraph. */
export const MAX_TITLE_LENGTH = 80;

/** Hard cap on the user text sent to the title model — title generation is cheap metadata. */
export const TITLE_INPUT_MAX_CHARS = 1_000;

/**
 * Deadline for the whole titling attempt (structured call + text fallback).
 * The chat loop AWAITS titling before the stream closes, so a stalled title
 * model call must not be able to hold the user's turn open indefinitely — on
 * timeout the chat stays untitled and the next completed turn retries.
 */
export const TITLE_GENERATION_TIMEOUT_MS = 10_000;

/**
 * Normalize raw model output into a persistable title: strip leading markdown /
 * quote artifacts and a "Title:" prefix, collapse whitespace, clamp length.
 * Returns an empty string when nothing usable remains (caller skips the update).
 */
export function sanitizeTitle(raw: string): string {
  const cleaned = raw
    .replace(/^[#*"'\s]+/, '')
    .replace(/^\s*title\s*:\s*/i, '')
    .replace(/^[#*"'\s]+/, '')
    .replace(/[#*"'\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.slice(0, MAX_TITLE_LENGTH).trim();
}

export function titlePromptInput(raw: string): string {
  return raw.trim().slice(0, TITLE_INPUT_MAX_CHARS);
}
