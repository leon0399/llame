# Chat search and episodic recall

Research behind llame's conversation search and episodic recall: the external
architecture recommendation, its cross-report against llame's code, prior art,
cross-lingual behavior and the post-#194 implementation review.

- [PostgreSQL-native multilingual chat search architecture](./2026-07-11-postgresql-multilingual-chat-search-chatgpt-com.md) - Recommends a PostgreSQL-native chat search design: a derived projection with full-text, trigram and vector legs fused by Reciprocal Rank Fusion, provider-neutral embeddings and no language detection.
- [Chat search to episodic memory: cross-report](./2026-07-12-chat-search-cross-report.md) - Reviews the external chat-search recommendation against llame's code, adopts its derived search projection with one correction and five substitutions, and maps the result onto issue #194 and phases #195 to #198.
- [Cross-lingual recall: asking in one language, finding a chat held in another](./2026-07-27-cross-lingual-recall.md) - Finds shipped phase 1 cannot bridge languages by design, the planned embedding leg can but degrades cross-lingual queries to single-leg RRF with measured same-language bias, and no cross-language eval category exists.
- [obra/episodic-memory deep-dive notes](./2026-07-12-obra-episodic-memory.md) - Examines obra/episodic-memory and concludes it validates the verbatim-as-index premise and lends borrowable patterns, but its retrieval is weaker than llame's plan and it has no recall-time injection framing.
- [Episodic memory after #194: implementation review](./2026-08-25-episodic-memory-implementation-review.md) - Argues issue #194 targets the wrong risk: search artifacts must never become evidence, so canonical chats stay the source of truth and hybrid RRF is a candidate generator, not a confidence model.
