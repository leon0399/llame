/**
 * Integration tests need a real Postgres and FAIL LOUDLY without one — a suite
 * that can't reach its dependencies must never green-skip (a silent zero-test
 * pass reads as coverage that doesn't exist).
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'integration tests require TEST_DATABASE_URL pointing at a real Postgres. ' +
      'Either run apps/api/scripts/rls-test.sh (provisions a throwaway DB with ' +
      'the worst-case owner role), or against the dev database: ' +
      'pnpm db:up && TEST_DATABASE_URL=postgres://app:app@localhost:5432/llame ' +
      'pnpm --filter api test:integration',
  );
}
