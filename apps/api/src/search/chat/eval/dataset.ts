/**
 * Versioned relevance-eval dataset for chat search (#195, design D8). A small set
 * of fixture conversations + labeled queries spanning the categories phase 1 must
 * handle (exact-title/exact-content/typo — asserted floors) and the ones it is
 * expected to be weak on until embeddings land (paraphrase, genuinely inflected
 * Russian/Spanish, an oversized single-message chunk — recorded-only, the
 * phase-3/chunker-fit measuring sticks).
 *
 * Each query's `expect` is the fixture key(s) whose chat should rank in the top K.
 */

export interface EvalFixture {
  key: string;
  title: string;
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
}

export type EvalCategory =
  | 'exact-title'
  | 'exact-content'
  | 'substring'
  | 'typo'
  | 'code'
  | 'paraphrase'
  | 'ru'
  | 'es'
  | 'mixed'
  | 'oversized';

export interface EvalQuery {
  query: string;
  category: EvalCategory;
  expect: Array<string>;
}

// Oversized-fixture filler (task 1.2): repeated to push the message text to
// several times `CHUNK_MAX_CHARS` (conversation-chunker.ts) so the corpus has
// at least one message the chunker cannot fit whole into a single budgeted
// chunk. The result is 10,901 characters. A distinctive tail sentence lets
// the eval query target content near the END of that oversized message, not
// its beginning. Exported so the integration suite can assert this property
// directly against `CHUNK_MAX_CHARS` instead of leaving it a comment.
const OVERSIZED_FILLER =
  'During the call we reviewed staffing levels, the quarterly budget, ' +
  'open hiring requisitions, and the rollout timeline for the internal ' +
  'tooling migration. ';
export const OVERSIZED_TRANSCRIPT_TEXT =
  OVERSIZED_FILLER.repeat(70) +
  'The final action item was to retire the legacy invoicing service and ' +
  'cut over to project Nightjar-7 before the end of Q3.';

export const EVAL_FIXTURES: Array<EvalFixture> = [
  {
    key: 'ts-generics',
    title: 'TypeScript generics deep dive',
    messages: [
      { role: 'user', text: 'how do conditional types and infer work' },
      {
        role: 'assistant',
        text: 'conditional types pick a branch; infer captures a type variable',
      },
    ],
  },
  {
    key: 'postgres-index',
    title: 'Postgres GIN index tuning',
    messages: [
      { role: 'user', text: 'why is my trigram search slow on a big table' },
      {
        role: 'assistant',
        text: 'add a GIN index with gin_trgm_ops on the normalized column',
      },
    ],
  },
  {
    key: 'docker-compose',
    title: 'Docker compose for local dev',
    messages: [
      { role: 'user', text: 'how to run postgres and redis with compose' },
      {
        role: 'assistant',
        text: 'define services in compose.yaml and docker compose up',
      },
    ],
  },
  {
    key: 'auth-jwt',
    title: 'Session auth vs JWT',
    messages: [
      { role: 'user', text: 'should I use httpOnly cookies or bearer tokens' },
      {
        role: 'assistant',
        text: 'cookies with a server session are safer against token theft',
      },
    ],
  },
  {
    key: 'error-code',
    title: 'Deploy failure investigation',
    messages: [
      { role: 'user', text: 'build died with error SVM-1842 during bundling' },
      {
        role: 'assistant',
        text: 'SVM-1842 means an out-of-memory in the bundler step',
      },
    ],
  },
  {
    key: 'ru-travel',
    title: 'Планирование поездки',
    messages: [
      { role: 'user', text: 'посоветуй маршрут по Испании на неделю' },
      { role: 'assistant', text: 'начни с Барселоны, потом Валенсия и Мадрид' },
    ],
  },
  {
    key: 'es-recipe',
    title: 'Receta de paella',
    messages: [
      { role: 'user', text: 'cómo preparo una paella valenciana auténtica' },
      { role: 'assistant', text: 'usa arroz bomba, azafrán y caldo de pollo' },
    ],
  },
  {
    key: 'mixed-lang',
    title: 'Debugging нашего deploy',
    messages: [
      { role: 'user', text: 'почему падает the production build на CI' },
      {
        role: 'assistant',
        text: 'проверь logs, скорее всего a missing env var',
      },
    ],
  },
  {
    key: 'oversized-transcript',
    title: 'Notes from a long onboarding call',
    messages: [
      { role: 'user', text: OVERSIZED_TRANSCRIPT_TEXT },
      { role: 'assistant', text: 'Got it, I will follow up on those items.' },
    ],
  },
];

export const EVAL_QUERIES: Array<EvalQuery> = [
  // exact-title (floor)
  {
    query: 'TypeScript generics deep dive',
    category: 'exact-title',
    expect: ['ts-generics'],
  },
  {
    query: 'postgres gin index tuning',
    category: 'exact-title',
    expect: ['postgres-index'],
  },
  {
    query: 'session auth vs jwt',
    category: 'exact-title',
    expect: ['auth-jwt'],
  },
  // exact-content (floor)
  {
    query: 'gin_trgm_ops',
    category: 'exact-content',
    expect: ['postgres-index'],
  },
  {
    query: 'httpOnly cookies',
    category: 'exact-content',
    expect: ['auth-jwt'],
  },
  {
    query: 'conditional types',
    category: 'exact-content',
    expect: ['ts-generics'],
  },
  // code / identifier (floor-ish — treated as exact-content class)
  { query: 'SVM-1842', category: 'code', expect: ['error-code'] },
  { query: 'compose.yaml', category: 'code', expect: ['docker-compose'] },
  // substring / mid-word fragment (floor) — the pre-projection ILIKE scan caught
  // these; whole-lexeme FTS doesn't, so the trigram leg's ILIKE arm must.
  { query: 'trgm', category: 'substring', expect: ['postgres-index'] },
  { query: 'valencia', category: 'substring', expect: ['es-recipe'] },
  // typo (floor)
  { query: 'postgre gin idex', category: 'typo', expect: ['postgres-index'] },
  { query: 'conditinal types', category: 'typo', expect: ['ts-generics'] },
  // paraphrase (recorded-only — expected weak on lexical)
  {
    query: 'protect against stolen access tokens',
    category: 'paraphrase',
    expect: ['auth-jwt'],
  },
  {
    query: 'my full-text query is too slow',
    category: 'paraphrase',
    expect: ['postgres-index'],
  },
  // ru (recorded-only — no stemming)
  { query: 'маршрут по Испании', category: 'ru', expect: ['ru-travel'] },
  { query: 'поездка', category: 'ru', expect: ['ru-travel'] },
  // ru, genuinely inflected — different case than the fixture text, so
  // `simple` (no-stemming) FTS cannot match on shared surface tokens.
  // "поездку"/"Испанию" (accusative) vs. the fixture's "поездки" (genitive
  // title) / "Испании" (prepositional, msg1).
  {
    query: 'поездку в Испанию',
    category: 'ru',
    expect: ['ru-travel'],
  },
  // "Мадрида" (genitive) / "Барселону" (accusative) vs. the fixture's
  // "Мадрид" (nominative) / "Барселоны" (genitive) — and a different lemma
  // ("путешествие" vs. "поездка"/"маршрут") entirely.
  {
    query: 'путешествие до Мадрида через Барселону',
    category: 'ru',
    expect: ['ru-travel'],
  },
  // es (recorded-only)
  { query: 'paella valenciana', category: 'es', expect: ['es-recipe'] },
  // es, genuinely inflected — different conjugation than the fixture's
  // "preparo" (1st person present): "preparó" (3rd person preterite).
  {
    query: 'quién preparó primero la paella',
    category: 'es',
    expect: ['es-recipe'],
  },
  // Number/gender agreement change vs. the fixture's singular "arroz",
  // "azafrán", and feminine-singular "auténtica": plural "arroces",
  // "azafranes", masculine-plural "auténticos".
  {
    query: 'arroces bomba con azafranes auténticos',
    category: 'es',
    expect: ['es-recipe'],
  },
  // mixed language
  { query: 'production build CI', category: 'mixed', expect: ['mixed-lang'] },
  // oversized (recorded-only — the corpus has no oversized fixture before
  // this; layer 2 (chunker-fit) is expected to move this row). Query targets
  // the END of a message several times CHUNK_MAX_CHARS, verifying lexical
  // search is unaffected by message length today (no chunk-level truncation).
  {
    query: 'project Nightjar-7',
    category: 'oversized',
    expect: ['oversized-transcript'],
  },
];

/** Categories whose recall is a hard floor in CI (lexical has no excuse to miss). */
export const FLOOR_CATEGORIES: ReadonlySet<EvalCategory> =
  new Set<EvalCategory>([
    'exact-title',
    'exact-content',
    'substring',
    'code',
    'typo',
  ]);
