import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { buildHybridSearchQuery, type HybridSearchConfig } from './fusion';

/** Distinctive names so every rendered identifier is unambiguous in assertions. */
function config(
  overrides: Partial<HybridSearchConfig> = {},
): HybridSearchConfig {
  return {
    query: 'needle query',
    likePattern: '%needle query%',
    document: {
      table: 'search_chat_documents',
      groupId: 'chat_id',
      id: 'document_id',
      fts: 'fts_vector',
      normalized: 'normalized_content',
      content: 'original_content',
    },
    parent: {
      table: 'chats',
      id: 'chat_pk',
      title: 'chat_title',
      recency: 'updated_at',
    },
    scope: {
      document: sql`d.owner_user_id = ${'owner-1'}`,
      parent: sql`c.owner_user_id = ${'owner-2'}`,
    },
    weights: { fts: 1.5, trgm: 0.75, title: 2.25 },
    limits: { fts: 111, trgm: 222, title: 333 },
    rrfK: 47,
    groupTopNWeights: [1, 0.25, 0.1],
    limit: 17,
    ...overrides,
  };
}

function compile(cfg: HybridSearchConfig = config()) {
  return new PgDialect().sqlToQuery(buildHybridSearchQuery(cfg));
}

describe('buildHybridSearchQuery', () => {
  it('qualifies every column against the builder-owned alias, dot-separated', () => {
    const { sql: text } = compile();

    // `col()` emits `"<alias>"."<column>"` — the dot is what keeps `d.chat_id`
    // from collapsing into one identifier.
    expect(text).toContain('"d"."chat_id"');
    expect(text).toContain('"d"."document_id"');
    expect(text).toContain('"d"."fts_vector"');
    expect(text).toContain('"d"."normalized_content"');
    expect(text).toContain('"d"."original_content"');
    expect(text).toContain('"c"."chat_pk"');
    expect(text).toContain('"c"."chat_title"');
    expect(text).toContain('"c"."updated_at"');
    // No unqualified/mis-aliased leak of the same names.
    expect(text).not.toContain('""."chat_title"');
    expect(text).not.toContain('"d""chat_id"');
  });

  it('aliases the document and parent tables as d and c', () => {
    const { sql: text } = compile();

    expect(text).toContain('"search_chat_documents" d');
    expect(text).toContain('"chats" c');
  });

  it('emits every CTE of the fusion pipeline in dependency order', () => {
    const { sql: text } = compile();

    // `(?<!\w)` so `fused`/`ranked` do not match inside `doc_fused`/`doc_ranked`.
    const order = [
      /WITH q AS \(/,
      /(?<!\w)fts_c AS \(/,
      /(?<!\w)trgm_c AS \(/,
      /(?<!\w)doc_fused AS \(/,
      /(?<!\w)doc_ranked AS \(/,
      /(?<!\w)group_content AS \(/,
      /(?<!\w)title_c AS \(/,
      /(?<!\w)fused AS \(/,
      /(?<!\w)ranked AS \(/,
    ];
    const positions = order.map((cte) => {
      const at = text.search(cte);
      expect(at, `missing CTE: ${String(cte)}`).toBeGreaterThanOrEqual(0);
      return at;
    });
    expect(positions).toStrictEqual([...positions].sort((a, b) => a - b));
  });

  it('builds the q CTE from the raw query and the escaped LIKE pattern', () => {
    const { sql: text, params } = compile();

    expect(text).toContain("websearch_to_tsquery('simple',");
    expect(text).toContain('::text AS raw');
    expect(text).toContain('::text AS like_pat');
    expect(params).toContain('needle query');
    expect(params).toContain('%needle query%');
  });

  it('ranks the FTS leg by ts_rank_cd and the trigram leg by word_similarity', () => {
    const { sql: text } = compile();

    expect(text).toContain('ts_rank_cd("d"."fts_vector", q.tsq)');
    expect(text).toContain('"d"."fts_vector" @@ q.tsq');
    expect(text).toContain('word_similarity(q.raw, "d"."normalized_content")');
    expect(text).toContain(
      'q.raw <% "d"."normalized_content" OR "d"."normalized_content" ILIKE q.like_pat',
    );
    expect(text).toContain('row_number() OVER (ORDER BY score DESC, doc_id)');
  });

  it('applies both scope predicates to every side of the query', () => {
    const { sql: text, params } = compile();

    // Document scope guards both document legs; parent scope guards the title
    // leg and the final `ranked` join.
    expect(text.split('d.owner_user_id').length - 1).toBe(2);
    expect(text.split('c.owner_user_id').length - 1).toBe(2);
    expect(params).toContain('owner-1');
    expect(params).toContain('owner-2');
  });

  it('emits one RRF term per leg with the configured weights and k', () => {
    const { sql: text, params } = compile();

    // `term()` renders `<weight> / (<k> + rank)` in double precision. Three
    // legs each supply their own `rank` literal, so all three must be present.
    expect(text).toContain('::double precision / (');
    expect(text.split('::double precision + rank)').length - 1).toBe(3);
    expect(params).toContain(1.5);
    expect(params).toContain(0.75);
    expect(params).toContain(2.25);
    expect(params.filter((p) => p === 47)).toHaveLength(3);
  });

  it('rolls the top-3 documents up to their parent with the configured weights', () => {
    const { sql: text, params } = compile();

    expect(text).toContain(
      'row_number() OVER (PARTITION BY group_id ORDER BY doc_score DESC, doc_id)',
    );
    expect(text).toContain('sum(CASE drank WHEN 1 THEN doc_score *');
    expect(text).toContain('WHEN 2 THEN doc_score *');
    expect(text).toContain('WHEN 3 THEN doc_score *');
    expect(text).toContain('ELSE 0 END) AS content_score');
    expect(text).toContain(
      '(array_agg(doc_id ORDER BY doc_score DESC, doc_id))[1] AS best_doc_id',
    );
    expect(text).toContain('WHERE drank <= 3 GROUP BY group_id');
    expect(params).toContain(0.25);
    expect(params).toContain(0.1);
  });

  it('scores the title leg as the greater of word_similarity and an ILIKE hit', () => {
    const { sql: text } = compile();

    expect(text).toContain(
      'GREATEST(word_similarity(q.raw, lower("c"."chat_title")), ("c"."chat_title" ILIKE q.like_pat)::int::double precision)',
    );
    expect(text).toContain(
      '"c"."chat_title" ILIKE q.like_pat OR q.raw <% lower("c"."chat_title")',
    );
    expect(text).toContain('row_number() OVER (ORDER BY score DESC, group_id)');
  });

  it('orders by pure relevance with a recency then id tie-break', () => {
    const { sql: text } = compile();

    expect(text).toContain(
      'ORDER BY f.score DESC, "c"."updated_at" DESC, "c"."chat_pk"',
    );
    expect(text).toContain('ORDER BY r.score DESC, r.recency DESC, r.group_id');
  });

  it('binds every leg limit and the final result cap as parameters', () => {
    const { params } = compile();

    expect(params).toContain(111);
    expect(params).toContain(222);
    expect(params).toContain(333);
    expect(params).toContain(17);
  });

  it('computes ts_headline only over the best document, NULL without one', () => {
    const { sql: text } = compile();

    expect(text).toContain('CASE WHEN gc.best_doc_id IS NOT NULL');
    expect(text).toContain(
      'ts_headline(\'simple\', "d"."original_content", q.tsq, \'StartSel=, StopSel=, MaxFragments=2, MinWords=8, MaxWords=28\')',
    );
    expect(text).toContain('ELSE NULL END AS snippet');
    expect(text).toContain(
      'LEFT JOIN group_content gc ON gc.group_id = r.group_id',
    );
    expect(text).toContain(
      'LEFT JOIN "search_chat_documents" d ON "d"."document_id" = gc.best_doc_id',
    );
  });

  it('projects the public result columns under their camelCase aliases', () => {
    const { sql: text } = compile();

    expect(text).toContain('SELECT r.group_id AS id, r.title, r.score,');
    expect(text).toContain('r.recency AS "updatedAt"');
    expect(text).toContain('gc.best_doc_id AS "bestDocumentId"');
  });

  it('reflects a different column mapping without leaking the previous names', () => {
    const { sql: text } = compile(
      config({
        document: {
          table: 'knowledge_documents',
          groupId: 'space_id',
          id: 'chunk_id',
          fts: 'chunk_fts',
          normalized: 'chunk_normalized',
          content: 'chunk_text',
        },
        parent: {
          table: 'knowledge_spaces',
          id: 'space_pk',
          title: 'space_name',
          recency: 'touched_at',
        },
      }),
    );

    expect(text).toContain('"knowledge_documents" d');
    expect(text).toContain('"knowledge_spaces" c');
    expect(text).toContain('"d"."chunk_fts"');
    expect(text).toContain('"c"."space_name"');
    expect(text).not.toContain('chat_id');
    expect(text).not.toContain('chat_title');
  });
});
