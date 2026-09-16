import { loadPackagedTemplate } from '../prompts/template-engine';

/**
 * Recall-time framing for owner-authored content, shared by every surface
 * that returns it: search results, Knowledge locator reads, and listings.
 *
 * The sentence is the packaged `prompts/content-notice.md`, rendered once at
 * module scope. It stays an exported string, not a render function: the
 * locator and the search tool both place it in a result field and
 * `knowledge-tools.ts` re-exports it, so what those call sites need is the
 * bytes, and every other caller would otherwise have to render.
 */
const renderContentNoticeTemplate = loadPackagedTemplate<Record<string, never>>(
  __dirname,
  'content-notice',
);

export const KNOWLEDGE_CONTENT_NOTICE = renderContentNoticeTemplate({});
