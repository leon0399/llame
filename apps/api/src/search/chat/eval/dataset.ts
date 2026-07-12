/**
 * Versioned relevance-eval dataset for chat search (#195, design D8). A small set
 * of fixture conversations + labeled queries spanning the categories phase 1 must
 * handle (exact-title/exact-content/typo — asserted floors) and the ones it is
 * expected to be weak on until embeddings land (paraphrase, inflected Russian —
 * recorded-only, the phase-3 measuring stick).
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
  | 'mixed';

export interface EvalQuery {
  query: string;
  category: EvalCategory;
  expect: string[];
}

export const EVAL_FIXTURES: EvalFixture[] = [
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
];

export const EVAL_QUERIES: EvalQuery[] = [
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
  // es (recorded-only)
  { query: 'paella valenciana', category: 'es', expect: ['es-recipe'] },
  // mixed language
  { query: 'production build CI', category: 'mixed', expect: ['mixed-lang'] },
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
