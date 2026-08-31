/**
 * Shared numeric limits for Knowledge Space filesystem access. Zero
 * dependencies, so every `knowledge-filesystem-*.ts` module can import from
 * here without risking a circular import with `knowledge-filesystem.ts`.
 */

export const KNOWLEDGE_MAX_ENTRIES = 20_000;
export const KNOWLEDGE_MAX_FILES = 5000;
export const KNOWLEDGE_MAX_SEARCH_FILE_BYTES = 1 * 1024 * 1024;
export const KNOWLEDGE_MAX_SEARCH_BYTES = 32 * 1024 * 1024;
export const KNOWLEDGE_MAX_READ_BYTES = 1 * 1024 * 1024;
export const KNOWLEDGE_MAX_READ_LINES = 2000;
export const KNOWLEDGE_MAX_PATH_BYTES = 1024;
export const KNOWLEDGE_MAX_PATH_COMPONENTS = 32;
export const KNOWLEDGE_MAX_SNIPPET_CODE_POINTS = 500;
