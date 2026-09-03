import { execFileSync } from "node:child_process";

/**
 * Standard SQL single-quote literal escaping (doubling embedded quotes) for
 * the direct-DB seed helpers. Values are test-authored or come from the
 * app's own responses — escape defensively anyway.
 */
export function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

/**
 * Run one direct-DB seed statement against the e2e database — the single
 * owner of the two connection paths every seed helper shares:
 *
 * - The normal throwaway-DB harness (no POSTGRES_URL) mirrors
 *   e2e/support/db-server.ts's `docker exec ... psql` idiom and connects as
 *   the `postgres` superuser.
 * - A caller-supplied POSTGRES_URL means Playwright is using an already
 *   migrated external database instead. Seed as the real app role under the
 *   owner's tenant context (`SET LOCAL app.current_user_id`) so FORCE RLS
 *   stays engaged — never require superuser access merely to run a browser
 *   proof; `ownerUserId` is mandatory on this path.
 *
 * Callers build only their own SQL string; neither path adds a root-level
 * database client dependency purely for seeding.
 */
export function runSeedSql(sql: string, ownerUserId?: string): void {
  const container = process.env.E2E_DB_CONTAINER ?? "llame-e2e-postgres";
  const dbPort = process.env.E2E_DB_PORT ?? "55433";
  const postgresUrl =
    process.env.POSTGRES_URL ??
    `postgres://app:app@localhost:${dbPort}/llame_e2e`;
  const databaseName = new URL(postgresUrl).pathname.replace(/^\//, "");

  if (process.env.POSTGRES_URL) {
    if (!ownerUserId) {
      throw new Error(
        "runSeedSql requires ownerUserId when POSTGRES_URL is set",
      );
    }
    execFileSync(
      "psql",
      [
        postgresUrl,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `BEGIN; SET LOCAL app.current_user_id = '${escapeSqlLiteral(ownerUserId)}'; ${sql} COMMIT;`,
      ],
      { stdio: "inherit" },
    );
    return;
  }

  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { stdio: "inherit" },
  );
}
