import { chmodSync, existsSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import { WRITER_STREAM_ID_PATTERN } from "@workspace/federation-experiment";

export interface RunRoute {
  readonly runId: string;
  readonly peerId: string;
  readonly routeEpoch: number;
}

export interface RunRouteRegistry {
  resolve(runId: string): RunRoute | null;
  bind(runId: string, peerId: string): RunRoute;
  rebind(runId: string, peerId: string, expectedRouteEpoch: number): RunRoute;
}

export interface SqliteRunRouteRegistryOptions {
  readonly databasePath: string;
}

function validateRunId(runId: string): void {
  if (runId.length === 0 || runId.length > 200 || runId.includes("/")) {
    throw new Error("invalid Run id");
  }
}

function validatePeerId(peerId: string): void {
  if (!WRITER_STREAM_ID_PATTERN.test(peerId)) {
    throw new Error("invalid peer id");
  }
}

function requireText(
  row: Record<string, SQLOutputValue>,
  column: string,
): string {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`invalid Run route ${column}`);
  return value;
}

function requireNumber(
  row: Record<string, SQLOutputValue>,
  column: string,
): number {
  const value = row[column];
  if (typeof value !== "number") {
    throw new Error(`invalid Run route ${column}`);
  }
  return value;
}

function parseRoute(row: Record<string, SQLOutputValue>): RunRoute {
  return {
    runId: requireText(row, "run_id"),
    peerId: requireText(row, "peer_id"),
    routeEpoch: requireNumber(row, "route_epoch"),
  };
}

export class SqliteRunRouteRegistry implements RunRouteRegistry {
  readonly #database: DatabaseSync;
  readonly #databasePath: string;

  public constructor(options: SqliteRunRouteRegistryOptions) {
    if (
      options.databasePath.length === 0 ||
      options.databasePath === ":memory:"
    ) {
      throw new Error("Run route registry requires a durable database path");
    }
    this.#databasePath = options.databasePath;
    this.#database = new DatabaseSync(options.databasePath);
    try {
      this.#database.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS run_routes (
          run_id TEXT PRIMARY KEY,
          peer_id TEXT NOT NULL,
          route_epoch INTEGER NOT NULL CHECK (route_epoch > 0),
          updated_at TEXT NOT NULL
        ) STRICT;
      `);
      this.#secureDatabaseFiles();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  public resolve(runId: string): RunRoute | null {
    validateRunId(runId);
    const row = this.#database
      .prepare(
        `SELECT run_id, peer_id, route_epoch FROM run_routes
         WHERE run_id = ?`,
      )
      .get(runId);
    return row === undefined ? null : parseRoute(row);
  }

  public bind(runId: string, peerId: string): RunRoute {
    validateRunId(runId);
    validatePeerId(peerId);
    return this.#writeTransaction(() => {
      const existing = this.resolve(runId);
      if (existing !== null) {
        if (existing.peerId !== peerId) {
          throw new Error("Run is already routed to another peer");
        }
        return existing;
      }
      this.#database
        .prepare(
          `INSERT INTO run_routes
            (run_id, peer_id, route_epoch, updated_at)
           VALUES (?, ?, 1, ?)`,
        )
        .run(runId, peerId, new Date().toISOString());
      return { runId, peerId, routeEpoch: 1 };
    });
  }

  public rebind(
    runId: string,
    peerId: string,
    expectedRouteEpoch: number,
  ): RunRoute {
    validateRunId(runId);
    validatePeerId(peerId);
    if (!Number.isInteger(expectedRouteEpoch) || expectedRouteEpoch <= 0) {
      throw new Error("invalid expected route epoch");
    }
    return this.#writeTransaction(() => {
      const result = this.#database
        .prepare(
          `UPDATE run_routes
           SET peer_id = ?, route_epoch = route_epoch + 1, updated_at = ?
           WHERE run_id = ? AND route_epoch = ?`,
        )
        .run(peerId, new Date().toISOString(), runId, expectedRouteEpoch);
      if (result.changes !== 1) throw new Error("Run route epoch conflict");
      return { runId, peerId, routeEpoch: expectedRouteEpoch + 1 };
    });
  }

  public close(): void {
    this.#database.close();
  }

  #writeTransaction<Result>(operation: () => Result): Result {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      this.#secureDatabaseFiles();
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
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
