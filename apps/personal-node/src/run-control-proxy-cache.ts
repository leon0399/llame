import { chmodSync, existsSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

export interface SqliteRunControlProxyCacheOptions {
  readonly databasePath: string;
}

export interface LastKnownRunControlState {
  readonly observedAt: string;
  readonly state: unknown;
}

function requireText(
  row: Record<string, SQLOutputValue>,
  column: string,
): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`invalid Run-control proxy cache ${column}`);
  }
  return value;
}

export class SqliteRunControlProxyCache {
  readonly #database: DatabaseSync;
  readonly #databasePath: string;

  public constructor(options: SqliteRunControlProxyCacheOptions) {
    if (
      options.databasePath.length === 0 ||
      options.databasePath === ":memory:"
    ) {
      throw new Error(
        "Run-control proxy cache requires a durable database path",
      );
    }
    this.#databasePath = options.databasePath;
    this.#database = new DatabaseSync(options.databasePath);
    try {
      this.#database.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS run_control_proxy_cache (
          request_key TEXT PRIMARY KEY,
          observed_at TEXT NOT NULL,
          state_json TEXT NOT NULL
        ) STRICT;
      `);
      this.#secureDatabaseFiles();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  public put(requestKey: string, state: unknown, now = new Date()): void {
    if (requestKey.length === 0 || requestKey.length > 2048) {
      throw new Error("invalid Run-control proxy cache key");
    }
    const stateJson = JSON.stringify(state);
    if (stateJson === undefined) {
      throw new Error("Run-control proxy state is not JSON serializable");
    }
    this.#database
      .prepare(
        `INSERT INTO run_control_proxy_cache
          (request_key, observed_at, state_json)
         VALUES (?, ?, ?)
         ON CONFLICT (request_key) DO UPDATE SET
           observed_at = excluded.observed_at,
           state_json = excluded.state_json`,
      )
      .run(requestKey, now.toISOString(), stateJson);
    this.#secureDatabaseFiles();
  }

  public get(requestKey: string): LastKnownRunControlState | null {
    const row = this.#database
      .prepare(
        `SELECT observed_at, state_json FROM run_control_proxy_cache
         WHERE request_key = ?`,
      )
      .get(requestKey);
    if (row === undefined) return null;
    const stateJson = requireText(row, "state_json");
    let state: unknown;
    try {
      const parsed: unknown = JSON.parse(stateJson);
      state = parsed;
    } catch {
      throw new Error("invalid cached Run-control state");
    }
    return {
      observedAt: requireText(row, "observed_at"),
      state,
    };
  }

  public close(): void {
    this.#database.close();
  }

  #secureDatabaseFiles(): void {
    for (const path of [
      this.#databasePath,
      `${this.#databasePath}-wal`,
      `${this.#databasePath}-shm`,
    ]) {
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  }
}
