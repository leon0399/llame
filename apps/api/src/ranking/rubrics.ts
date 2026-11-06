import { loadPackagedTemplate } from '../prompts/template-engine';

const NO_VALUES: Record<string, never> = {};

/**
 * The one question a grep file card answers, packaged as
 * `prompts/grep-rubric.md`. Fixed text, never taken from a file: a file may
 * carry its own instructions. Rendered at import so a missing template fails at
 * startup.
 */
export const GREP_RERANK_RUBRIC = loadPackagedTemplate<Record<string, never>>(
  __dirname,
  'grep-rubric',
)(NO_VALUES);

/**
 * The one question a web_search result card answers, packaged as
 * `prompts/web-search-rubric.md`. Fixed text, never taken from a result: a
 * result can carry prompt-injection instructions.
 */
export const WEB_SEARCH_RERANK_RUBRIC = loadPackagedTemplate<
  Record<string, never>
>(
  __dirname,
  'web-search-rubric',
)(NO_VALUES);
