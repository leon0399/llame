import { sql, type SQL } from 'drizzle-orm';

/**
 * Reciprocal Rank Fusion (search/core) — the drift-prone relevance kernel, shared
 * by every searchable corpus (chat search now; knowledge/RAG and curated memory
 * later) so the fusion math lives in exactly one place. Fuses independent ranked
 * candidate legs by RANK, never by mixing raw scores (cosine, ts_rank, and
 * similarity live on unrelated scales that shift per dataset).
 */
export const RRF_DEFAULT_K = 60;

/**
 * Pure RRF score for one item given its 1-based rank in each leg (undefined =
 * absent from that leg) and the per-leg weights. Documents the exact formula the
 * SQL builder emits; unit-tested in isolation.
 */
export function rrfScore(
  legs: ReadonlyArray<{ weight: number; rank: number | undefined }>,
  k: number = RRF_DEFAULT_K,
): number {
  return legs.reduce(
    (acc, leg) =>
      acc + (leg.rank === undefined ? 0 : leg.weight / (k + leg.rank)),
    0,
  );
}

/**
 * Structural tenant-isolation guard: the hybrid builder REFUSES to construct a
 * query without a scope predicate (grill decision D10). The in-CTE owner filter
 * is defense-in-depth behind RLS, but making it a required, throw-on-absence
 * argument means an unscoped search query cannot be expressed by accident.
 */
export function assertScopePredicate(scope: SQL | undefined): asserts scope {
  if (scope === undefined) {
    throw new Error(
      'hybrid search builder: a scope predicate is required (fail-closed tenant isolation)',
    );
  }
}

/**
 * Column/table references for one side of the search, as drizzle `SQL` fragments.
 * The builder aliases the document table `d` and the parent table `c`, so these
 * fragments MUST use those aliases (e.g. `sql\`d.fts\``, `sql\`c.title\``). They
 * come only from our own code (never user input), so no identifier quoting needed.
 */
export interface HybridSearchColumns {
  /** Unaliased table name, e.g. `sql\`search_documents\``. */
  table: SQL;
  /** Grouping key on the document side (the parent id it rolls up to), `d.chat_id`. */
  groupId?: SQL;
  /** Row id, `d.id` / `c.id`. */
  id: SQL;
  /** `d.fts` (documents only). */
  fts?: SQL;
  /** `d.normalized_content` (documents only). */
  normalized?: SQL;
  /** `d.content` — snippet source (documents only). */
  content?: SQL;
  /** `c.title` (parent only). */
  title?: SQL;
  /** Recency tie-break column, `d.last_message_at` / `c.updated_at`. */
  recency: SQL;
}

export interface HybridSearchConfig {
  /** Raw user query (for `websearch_to_tsquery` + `word_similarity`, wildcard-safe). */
  query: string;
  /** LIKE pattern with `%`/`_`/`\` already escaped and wrapped in `%…%`. */
  likePattern: string;
  document: HybridSearchColumns;
  parent: HybridSearchColumns;
  /** REQUIRED per-side scope predicates (e.g. `sql\`d.owner_user_id = ${uid}\``). */
  scope: { document: SQL; parent: SQL };
  weights: { fts: number; trgm: number; title: number };
  limits: { fts: number; trgm: number; title: number };
  rrfK: number;
  /** Weighted top-N document aggregation per group, e.g. `[1, 0.25, 0.1]`. */
  groupTopNWeights: number[];
  /** Final chat result cap. */
  limit: number;
}

/**
 * Build the hybrid lexical search query for the shared "chunks grouped into a
 * parent, plus a parent-field (title) leg" shape. Three ranked candidate legs
 * (FTS, trigram over documents; ILIKE/word_similarity over the parent), RRF-fused;
 * documents roll up to their parent with weighted top-N aggregation; the parent
 * (title) leg fuses at parent level. Ordering is PURE RELEVANCE with a recency +
 * id tie-break (grill decision D4). A parent with matching documents carries a
 * `ts_headline` snippet over its best document; a title-only match has a NULL
 * snippet. Returns a drizzle `SQL` ready for `db.execute`.
 */
export function buildHybridSearchQuery(config: HybridSearchConfig): SQL {
  assertScopePredicate(config.scope.document);
  assertScopePredicate(config.scope.parent);

  const d = config.document;
  const c = config.parent;
  const k = config.rrfK;
  const [w1 = 0, w2 = 0, w3 = 0] = config.groupTopNWeights;
  const topN = config.groupTopNWeights.length;

  // Per-leg RRF term (weight / (k + rank)) as double precision.
  const term = (weight: number, rank: SQL) =>
    sql`${weight}::double precision / (${k}::double precision + ${rank})`;

  return sql`
    WITH q AS (
      SELECT
        websearch_to_tsquery('simple', ${config.query}) AS tsq,
        ${config.query}::text AS raw,
        ${config.likePattern}::text AS like_pat
    ),
    fts_c AS (
      SELECT ${d.groupId} AS group_id, ${d.id} AS doc_id,
        row_number() OVER (ORDER BY ts_rank_cd(${d.fts}, q.tsq) DESC, ${d.id}) AS rank
      FROM ${d.table} d CROSS JOIN q
      WHERE (${config.scope.document}) AND ${d.fts} @@ q.tsq
      ORDER BY ts_rank_cd(${d.fts}, q.tsq) DESC, ${d.id}
      LIMIT ${config.limits.fts}
    ),
    trgm_c AS (
      SELECT ${d.groupId} AS group_id, ${d.id} AS doc_id,
        row_number() OVER (ORDER BY word_similarity(q.raw, ${d.normalized}) DESC, ${d.id}) AS rank
      FROM ${d.table} d CROSS JOIN q
      WHERE (${config.scope.document}) AND q.raw <% ${d.normalized}
      ORDER BY word_similarity(q.raw, ${d.normalized}) DESC, ${d.id}
      LIMIT ${config.limits.trgm}
    ),
    doc_fused AS (
      SELECT group_id, doc_id, sum(t) AS doc_score FROM (
        SELECT group_id, doc_id, ${term(config.weights.fts, sql`rank`)} AS t FROM fts_c
        UNION ALL
        SELECT group_id, doc_id, ${term(config.weights.trgm, sql`rank`)} AS t FROM trgm_c
      ) u GROUP BY group_id, doc_id
    ),
    doc_ranked AS (
      SELECT group_id, doc_id, doc_score,
        row_number() OVER (PARTITION BY group_id ORDER BY doc_score DESC, doc_id) AS drank
      FROM doc_fused
    ),
    group_content AS (
      SELECT group_id,
        sum(CASE drank WHEN 1 THEN doc_score * ${w1}::double precision
                       WHEN 2 THEN doc_score * ${w2}::double precision
                       WHEN 3 THEN doc_score * ${w3}::double precision
                       ELSE 0 END) AS content_score,
        (array_agg(doc_id ORDER BY doc_score DESC, doc_id))[1] AS best_doc_id
      FROM doc_ranked WHERE drank <= ${topN} GROUP BY group_id
    ),
    title_c AS (
      SELECT ${c.id} AS group_id,
        row_number() OVER (
          ORDER BY GREATEST(word_similarity(q.raw, lower(${c.title})),
                            (${c.title} ILIKE q.like_pat)::int::double precision) DESC, ${c.id}
        ) AS rank
      FROM ${c.table} c CROSS JOIN q
      WHERE (${config.scope.parent})
        AND (${c.title} ILIKE q.like_pat OR q.raw <% lower(${c.title}))
      ORDER BY GREATEST(word_similarity(q.raw, lower(${c.title})),
                        (${c.title} ILIKE q.like_pat)::int::double precision) DESC, ${c.id}
      LIMIT ${config.limits.title}
    ),
    fused AS (
      -- One group has at most one non-null best_doc_id (from group_content); the
      -- title leg contributes NULL. max() has no uuid overload, so aggregate via
      -- text — it simply passes the single non-null id through.
      SELECT group_id, sum(t) AS score, max(best_doc_id::text)::uuid AS best_doc_id FROM (
        SELECT group_id, content_score AS t, best_doc_id FROM group_content
        UNION ALL
        SELECT group_id, ${term(config.weights.title, sql`rank`)} AS t, NULL::uuid AS best_doc_id FROM title_c
      ) u GROUP BY group_id
    )
    SELECT ${c.id} AS id, ${c.title} AS title, f.score,
      CASE WHEN f.best_doc_id IS NOT NULL
        THEN ts_headline('simple', ${d.content}, q.tsq, 'StartSel=, StopSel=, MaxFragments=2, MinWords=8, MaxWords=28')
        ELSE NULL END AS snippet,
      ${c.recency} AS "updatedAt"
    FROM fused f
    JOIN ${c.table} c ON ${c.id} = f.group_id
    CROSS JOIN q
    LEFT JOIN ${d.table} d ON ${d.id} = f.best_doc_id
    ORDER BY f.score DESC, ${c.recency} DESC, ${c.id}
    LIMIT ${config.limit}
  `;
}
