/** The typed error vocabulary every Knowledge filesystem operation throws
 * into, and nothing else — no dependency on the port, the adapter, or any
 * read/search machinery. */

export type KnowledgeFilesystemErrorCode =
  | 'knowledge_path_invalid'
  | 'knowledge_not_found'
  | 'knowledge_range_invalid'
  | 'knowledge_content_invalid'
  | 'knowledge_limit_exceeded'
  | 'knowledge_space_unavailable'
  | 'knowledge_cancelled';

export class KnowledgeFilesystemError extends Error {
  constructor(readonly code: KnowledgeFilesystemErrorCode) {
    super(messageFor(code));
    this.name = 'KnowledgeFilesystemError';
  }
}

function messageFor(code: KnowledgeFilesystemErrorCode): string {
  switch (code) {
    case 'knowledge_path_invalid':
      return 'The Knowledge path is invalid.';
    case 'knowledge_not_found':
      return 'The Knowledge note was not found.';
    case 'knowledge_range_invalid':
      return 'The Knowledge line range is invalid.';
    case 'knowledge_content_invalid':
      return 'The Knowledge note is not valid UTF-8.';
    case 'knowledge_limit_exceeded':
      return 'The Knowledge operation exceeded its limit.';
    case 'knowledge_space_unavailable':
      return 'The Knowledge Space is unavailable.';
    case 'knowledge_cancelled':
      return 'The Knowledge operation was cancelled.';
  }
}
