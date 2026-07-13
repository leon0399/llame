// search/core — corpus-agnostic search platform primitives (chat-search-platform
// D10). Imports NOTHING corpus-specific (no chats/, no messages). Chat search is
// the first consumer; knowledge/RAG and curated memory reuse these same kernels.
export * from './text';
export * from './chunking';
export * from './fusion';
export * from './eval';
