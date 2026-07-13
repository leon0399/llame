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

/** A qualified column reference `"<alias>"."<column>"`. The builder owns the
 *  alias so callers pass column NAMES, never freeform SQL — a caller cannot
 *  accidentally reference the wrong table's like-named column. */
function col(alias: string, column: string): SQL {
  return sql`${sql.identifier(alias)}.${sql.identifier(column)}`;
}

/** The document (chunk) side of the search — one row per chunk, rolled up to a
 *  parent. Column NAMES only; the builder aliases the table `d`. */
export interface DocumentColumns {
  /** Projection table name, e.g. `search_chat_documents`. */
  table: string;
  /** Grouping key rolled up to the parent, e.g. `chat_id`. */
  groupId: string;
  id: string;
  /** Generated `tsvector` column (FTS leg). */
  fts: string;
  /** Normalized match column (trigram leg + snippet source). */
  normalized: string;
  /** Original-cased content (snippet source). */
  content: string;
}

/** The parent side — the row a result IS (a chat). Column NAMES only; the builder
 *  aliases the table `c`. */
export interface ParentColumns {
  table: string;
  id: string;
  title: string;
  /** Recency tie-break + the result's `updatedAt`. */
  recency: string;
}

export interface HybridSearchConfig {
  /** Raw user query (for `websearch_to_tsquery` + `word_similarity`, wildcard-safe). */
  query: string;
  /** LIKE pattern with `%`/`_`/`\` already escaped and wrapped in `%…%`. */
  likePattern: string;
  document: DocumentColumns;
  parent: ParentColumns;
  /**
   * REQUIRED per-side scope predicates (fail-closed tenant isolation). Written by
   * the caller as a deliberate predicate over the builder's aliases (`d` for the
   * document side, `c` for the parent), e.g. `sql\`d.owner_user_id = ${uid}\``.
   */
  scope: { document: SQL; parent: SQL };
  weights: { fts: number; trgm: number; title: number };
  limits: { fts: number; trgm: number; title: number };
  rrfK: number;
  /** Weighted top-3 document aggregation per group, e.g. `[1, 0.25, 0.1]`. */
  groupTopNWeights: [number, number, number];
  /** Final chat result cap. */
  limit: number;
}

/**
 * Build the hybrid lexical search query for the shared "chunks grouped into a
 * parent, plus a parent-field (title) leg" shape. Three ranked candidate legs
 * (FTS, trigram over documents; ILIKE/word_similarity over the parent), RRF-fused;
 * documents roll up to their parent with weighted top-3 aggregation; the parent
 * (title) leg fuses at parent level. Ordering is PURE RELEVANCE with a recency +
 * id tie-break (grill decision D4). The expensive `ts_headline` snippet is
 * computed only for the final page (after the LIMIT), over the best document of
 * each returned chat; a title-only match has a NULL snippet. Returns a drizzle
 * `SQL` ready for `db.execute`.
 */
export function buildHybridSearchQuery(config: HybridSearchConfig): SQL {
  assertScopePredicate(config.scope.document);
  assertScopePredicate(config.scope.parent);

  const d = config.document;
  const c = config.parent;
  const k = config.rrfK;
  const [w1, w2, w3] = config.groupTopNWeights;

  // Per-leg RRF term (weight / (k + rank)) as double precision.
  const term = (weight: number, rank: SQL) =>
    sql`${weight}::double precision / (${k}::double precision + ${rank})`;

  const dGroup = col('d', d.groupId);
  const dId = col('d', d.id);
  const dFts = col('d', d.fts);
  const dNorm = col('d', d.normalized);
  const dContent = col('d', d.content);
  const cId = col('c', c.id);
  const cTitle = col('c', c.title);
  const cRecency = col('c', c.recency);
  const dTable = sql`${sql.identifier(d.table)} d`;
  const cTable = sql`${sql.identifier(c.table)} c`;

  const titleScore = sql`GREATEST(word_similarity(q.raw, lower(${cTitle})), (${cTitle} ILIKE q.like_pat)::int::double precision)`;

  return sql`
    WITH q AS (
      SELECT
        websearch_to_tsquery('simple', ${config.query}) AS tsq,
        ${config.query}::text AS raw,
        ${config.likePattern}::text AS like_pat
    ),
    -- Each leg materializes its score ONCE (referenced by both the window rank
    -- and the LIMIT ordering) instead of re-evaluating the ranking function.
    fts_c AS (
      SELECT group_id, doc_id,
        row_number() OVER (ORDER BY score DESC, doc_id) AS rank
      FROM (
        SELECT ${dGroup} AS group_id, ${dId} AS doc_id,
          ts_rank_cd(${dFts}, q.tsq) AS score
        FROM ${dTable} CROSS JOIN q
        WHERE (${config.scope.document}) AND ${dFts} @@ q.tsq
        ORDER BY score DESC, doc_id
        LIMIT ${config.limits.fts}
      ) s
    ),
    -- Fuzzy (word_similarity) OR exact-substring (ILIKE): the substring arm
    -- restores the mid-word/short-fragment recall the pre-projection ILIKE scan
    -- had (indexed by the same gin_trgm_ops index for >=3-char patterns), which
    -- whole-lexeme FTS and word_similarity alone miss. Both q.raw and q.like_pat
    -- are the normalized (lowercased) query, matching the lowercased corpus.
    trgm_c AS (
      SELECT group_id, doc_id,
        row_number() OVER (ORDER BY score DESC, doc_id) AS rank
      FROM (
        SELECT ${dGroup} AS group_id, ${dId} AS doc_id,
          word_similarity(q.raw, ${dNorm}) AS score
        FROM ${dTable} CROSS JOIN q
        WHERE (${config.scope.document})
          AND (q.raw <% ${dNorm} OR ${dNorm} ILIKE q.like_pat)
        ORDER BY score DESC, doc_id
        LIMIT ${config.limits.trgm}
      ) s
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
      FROM doc_ranked WHERE drank <= 3 GROUP BY group_id
    ),
    title_c AS (
      SELECT group_id,
        row_number() OVER (ORDER BY score DESC, group_id) AS rank
      FROM (
        SELECT ${cId} AS group_id, ${titleScore} AS score
        FROM ${cTable} CROSS JOIN q
        WHERE (${config.scope.parent})
          AND (${cTitle} ILIKE q.like_pat OR q.raw <% lower(${cTitle}))
        ORDER BY score DESC, ${cId}
        LIMIT ${config.limits.title}
      ) s
    ),
    -- Score-only fusion (no foreign-key payload routed through the aggregate).
    fused AS (
      SELECT group_id, sum(t) AS score FROM (
        SELECT group_id, content_score AS t FROM group_content
        UNION ALL
        SELECT group_id, ${term(config.weights.title, sql`rank`)} AS t FROM title_c
      ) u GROUP BY group_id
    ),
    -- Apply the final order + LIMIT on cheap columns BEFORE the costly ts_headline.
    ranked AS (
      SELECT f.group_id, f.score, ${cRecency} AS recency, ${cTitle} AS title
      FROM fused f JOIN ${cTable} ON ${cId} = f.group_id
      WHERE (${config.scope.parent})
      ORDER BY f.score DESC, ${cRecency} DESC, ${cId}
      LIMIT ${config.limit}
    )
    SELECT r.group_id AS id, r.title, r.score,
      CASE WHEN gc.best_doc_id IS NOT NULL
        THEN ts_headline('simple', ${dContent}, q.tsq, 'StartSel=, StopSel=, MaxFragments=2, MinWords=8, MaxWords=28')
        ELSE NULL END AS snippet,
      r.recency AS "updatedAt"
    FROM ranked r
    CROSS JOIN q
    LEFT JOIN group_content gc ON gc.group_id = r.group_id
    LEFT JOIN ${dTable} ON ${dId} = gc.best_doc_id
    ORDER BY r.score DESC, r.recency DESC, r.group_id
  `;
}
