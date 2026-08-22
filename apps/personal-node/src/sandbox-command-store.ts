import { createHash } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import { WRITER_STREAM_ID_PATTERN } from "@workspace/federation-experiment";
import { z } from "zod";

import {
  validateSandboxCommandRequest,
  type SandboxCommandRequest,
} from "./sandbox-container-contract.js";
import type { SandboxCommandResult } from "./sandbox-container-lifecycle.js";

const MAX_STORED_OUTPUT_BYTES = 256 * 1024;

const commandIdentitySchema = z.strictObject({
  realmId: z.string().min(1).max(200),
  runId: z.string().min(1).max(200),
  executorNodeId: z.string().regex(WRITER_STREAM_ID_PATTERN),
  authorityEpoch: z.number().int().positive(),
  commandId: z.string().min(1).max(200),
  request: z.strictObject({
    command: z.string(),
    args: z.array(z.string()),
  }),
});
const commandAuthoritySchema = commandIdentitySchema.pick({
  realmId: true,
  runId: true,
  executorNodeId: true,
  authorityEpoch: true,
});

const commandResultSchema = z.strictObject({
  exitCode: z.number().int().min(0).max(255),
  stdout: z.string(),
  stderr: z.string(),
});

export interface SandboxCommandIdentity {
  readonly realmId: string;
  readonly runId: string;
  readonly executorNodeId: string;
  readonly authorityEpoch: number;
  readonly commandId: string;
  readonly request: SandboxCommandRequest;
}

export type SandboxCommandAuthority = Pick<
  SandboxCommandIdentity,
  "realmId" | "runId" | "executorNodeId" | "authorityEpoch"
>;

export type SandboxCommandAuthorityActivity =
  | "quiescent"
  | "in-progress"
  | "outcome_unknown";

export interface SandboxCommandReceiptIdentity {
  readonly runId: string;
  readonly commandId: string;
  readonly executorNodeId: string;
  readonly authorityEpoch: number;
}

export type SandboxCommandReceipt =
  | (SandboxCommandReceiptIdentity & {
      readonly status: "completed";
      readonly result: SandboxCommandResult;
    })
  | (SandboxCommandReceiptIdentity & {
      readonly status: "outcome_unknown";
    });

export type SandboxCommandReservation =
  | { readonly status: "reserved" }
  | { readonly status: "in-progress" }
  | SandboxCommandReceipt;

export class SandboxCommandConflictError extends Error {
  public constructor() {
    super("Sandbox command ID conflicts with existing receipt");
    this.name = "SandboxCommandConflictError";
  }
}

export class SqliteSandboxCommandStore {
  readonly #database: DatabaseSync;
  readonly #databasePath: string;
  readonly #realmId: string;

  public constructor(options: {
    readonly databasePath: string;
    readonly realmId: string;
  }) {
    if (
      options.databasePath.length === 0 ||
      options.databasePath === ":memory:"
    ) {
      throw new Error("Sandbox command store requires a durable database path");
    }
    this.#databasePath = options.databasePath;
    this.#realmId = options.realmId;
    this.#database = new DatabaseSync(options.databasePath);
    try {
      this.#initializeSchema();
      this.#loadOrInitializeRealm();
      this.#recoverPending();
      this.#secureDatabaseFiles();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  public reserve(input: SandboxCommandIdentity): SandboxCommandReservation {
    const parsed = this.#parseIdentity(input);
    const requestHash = this.#requestHash(parsed.request);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#row(parsed.runId, parsed.commandId);
      if (existing === undefined) {
        this.#database
          .prepare(
            `INSERT INTO sandbox_command_receipts
              (realm_id, run_id, command_id, executor_node_id, authority_epoch,
               request_hash, state, result_json)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL)`,
          )
          .run(
            parsed.realmId,
            parsed.runId,
            parsed.commandId,
            parsed.executorNodeId,
            parsed.authorityEpoch,
            requestHash,
          );
        this.#database.exec("COMMIT");
        this.#secureDatabaseFiles();
        return { status: "reserved" };
      }
      this.#assertMatches(existing, parsed, requestHash);
      const reservation = this.#reservation(existing);
      this.#database.exec("COMMIT");
      return reservation;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public complete(
    input: SandboxCommandIdentity,
    result: SandboxCommandResult,
  ): SandboxCommandReceipt {
    const parsed = this.#parseIdentity(input);
    const parsedResult = this.#parseResult(result);
    const requestHash = this.#requestHash(parsed.request);
    const resultJson = JSON.stringify(parsedResult);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#requiredRow(parsed.runId, parsed.commandId);
      this.#assertMatches(existing, parsed, requestHash);
      const state = this.#text(existing, "state");
      if (state === "outcome_unknown") {
        throw new Error("Sandbox command outcome is already unknown");
      }
      if (state === "completed") {
        if (this.#text(existing, "result_json") !== resultJson) {
          throw new SandboxCommandConflictError();
        }
        const receipt = this.#receipt(existing);
        this.#database.exec("COMMIT");
        return receipt;
      }
      this.#database
        .prepare(
          `UPDATE sandbox_command_receipts
           SET state = 'completed', result_json = ?
           WHERE run_id = ? AND command_id = ? AND state = 'pending'`,
        )
        .run(resultJson, parsed.runId, parsed.commandId);
      const receipt = this.#receipt(
        this.#requiredRow(parsed.runId, parsed.commandId),
      );
      this.#database.exec("COMMIT");
      return receipt;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public markOutcomeUnknown(
    input: SandboxCommandIdentity,
  ): SandboxCommandReceipt {
    const parsed = this.#parseIdentity(input);
    const requestHash = this.#requestHash(parsed.request);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#requiredRow(parsed.runId, parsed.commandId);
      this.#assertMatches(existing, parsed, requestHash);
      if (this.#text(existing, "state") === "completed") {
        throw new SandboxCommandConflictError();
      }
      this.#database
        .prepare(
          `UPDATE sandbox_command_receipts
           SET state = 'outcome_unknown'
           WHERE run_id = ? AND command_id = ? AND state = 'pending'`,
        )
        .run(parsed.runId, parsed.commandId);
      const receipt = this.#receipt(
        this.#requiredRow(parsed.runId, parsed.commandId),
      );
      this.#database.exec("COMMIT");
      return receipt;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public release(input: SandboxCommandIdentity): {
    readonly status: "released";
  } {
    const parsed = this.#parseIdentity(input);
    const requestHash = this.#requestHash(parsed.request);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#requiredRow(parsed.runId, parsed.commandId);
      this.#assertMatches(existing, parsed, requestHash);
      if (this.#text(existing, "state") !== "pending") {
        throw new SandboxCommandConflictError();
      }
      this.#database
        .prepare(
          `DELETE FROM sandbox_command_receipts
           WHERE run_id = ? AND command_id = ? AND state = 'pending'`,
        )
        .run(parsed.runId, parsed.commandId);
      this.#database.exec("COMMIT");
      return { status: "released" };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public authorityActivity(
    input: SandboxCommandAuthority,
  ): SandboxCommandAuthorityActivity {
    const parsed = this.#parseAuthority(input);
    const row = this.#database
      .prepare(
        `SELECT state
         FROM sandbox_command_receipts
         WHERE realm_id = ? AND run_id = ? AND executor_node_id = ?
           AND authority_epoch = ?
           AND (
             state = 'pending' OR
             (state = 'outcome_unknown' AND contained = 0)
           )
         ORDER BY CASE state WHEN 'pending' THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(
        parsed.realmId,
        parsed.runId,
        parsed.executorNodeId,
        parsed.authorityEpoch,
      );
    if (row === undefined) return "quiescent";
    return this.#text(row, "state") === "pending"
      ? "in-progress"
      : "outcome_unknown";
  }

  public containOutcomeUnknown(input: SandboxCommandAuthority): {
    readonly contained: number;
  } {
    const parsed = this.#parseAuthority(input);
    const result = this.#database
      .prepare(
        `UPDATE sandbox_command_receipts
         SET contained = 1
         WHERE realm_id = ? AND run_id = ? AND executor_node_id = ?
           AND authority_epoch = ? AND state = 'outcome_unknown'
           AND contained = 0`,
      )
      .run(
        parsed.realmId,
        parsed.runId,
        parsed.executorNodeId,
        parsed.authorityEpoch,
      );
    return { contained: Number(result.changes) };
  }

  public close(): void {
    this.#database.close();
  }

  #parseIdentity(input: SandboxCommandIdentity): SandboxCommandIdentity {
    const parsed = commandIdentitySchema.parse(input);
    if (parsed.realmId !== this.#realmId) {
      throw new Error("Sandbox command belongs to a different Realm");
    }
    validateSandboxCommandRequest(parsed.request);
    return parsed;
  }

  #parseAuthority(input: SandboxCommandAuthority): SandboxCommandAuthority {
    const parsed = commandAuthoritySchema.parse(input);
    if (parsed.realmId !== this.#realmId) {
      throw new Error("Sandbox command belongs to a different Realm");
    }
    return parsed;
  }

  #parseResult(result: SandboxCommandResult): SandboxCommandResult {
    const parsed = commandResultSchema.parse(result);
    if (
      Buffer.byteLength(parsed.stdout) > MAX_STORED_OUTPUT_BYTES ||
      Buffer.byteLength(parsed.stderr) > MAX_STORED_OUTPUT_BYTES
    ) {
      throw new Error("Sandbox command result exceeds the output boundary");
    }
    return parsed;
  }

  #requestHash(request: SandboxCommandRequest): string {
    return createHash("sha256").update(JSON.stringify(request)).digest("hex");
  }

  #row(
    runId: string,
    commandId: string,
  ): Record<string, SQLOutputValue> | undefined {
    return this.#database
      .prepare(
        `SELECT realm_id, run_id, command_id, executor_node_id,
                authority_epoch, request_hash, state, result_json
         FROM sandbox_command_receipts
         WHERE run_id = ? AND command_id = ?`,
      )
      .get(runId, commandId) as Record<string, SQLOutputValue> | undefined;
  }

  #requiredRow(
    runId: string,
    commandId: string,
  ): Record<string, SQLOutputValue> {
    const row = this.#row(runId, commandId);
    if (row === undefined) throw new Error("Sandbox command is not reserved");
    return row;
  }

  #assertMatches(
    row: Record<string, SQLOutputValue>,
    input: SandboxCommandIdentity,
    requestHash: string,
  ): void {
    if (
      this.#text(row, "realm_id") !== input.realmId ||
      this.#text(row, "executor_node_id") !== input.executorNodeId ||
      this.#integer(row, "authority_epoch") !== input.authorityEpoch ||
      this.#text(row, "request_hash") !== requestHash
    ) {
      throw new SandboxCommandConflictError();
    }
  }

  #reservation(row: Record<string, SQLOutputValue>): SandboxCommandReservation {
    return this.#text(row, "state") === "pending"
      ? { status: "in-progress" }
      : this.#receipt(row);
  }

  #receipt(row: Record<string, SQLOutputValue>): SandboxCommandReceipt {
    const identity: SandboxCommandReceiptIdentity = {
      runId: this.#text(row, "run_id"),
      commandId: this.#text(row, "command_id"),
      executorNodeId: this.#text(row, "executor_node_id"),
      authorityEpoch: this.#integer(row, "authority_epoch"),
    };
    const state = this.#text(row, "state");
    if (state === "outcome_unknown") {
      return { status: "outcome_unknown", ...identity };
    }
    if (state !== "completed") {
      throw new Error("Sandbox command has no receipt");
    }
    const resultJson = this.#text(row, "result_json");
    let result: unknown;
    try {
      result = JSON.parse(resultJson);
    } catch {
      throw new Error("invalid stored Sandbox command result");
    }
    return {
      status: "completed",
      ...identity,
      result: this.#parseResult(commandResultSchema.parse(result)),
    };
  }

  #text(row: Record<string, SQLOutputValue>, column: string): string {
    const value = row[column];
    if (typeof value !== "string") {
      throw new Error(`invalid Sandbox command ${column}`);
    }
    return value;
  }

  #integer(row: Record<string, SQLOutputValue>, column: string): number {
    const value = row[column];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(`invalid Sandbox command ${column}`);
    }
    return value;
  }

  #initializeSchema(): void {
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sandbox_command_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sandbox_command_receipts (
        realm_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        executor_node_id TEXT NOT NULL,
        authority_epoch INTEGER NOT NULL CHECK (authority_epoch > 0),
        request_hash TEXT NOT NULL,
        state TEXT NOT NULL
          CHECK (state IN ('pending', 'completed', 'outcome_unknown')),
        result_json TEXT,
        contained INTEGER NOT NULL DEFAULT 0 CHECK (contained IN (0, 1)),
        PRIMARY KEY (run_id, command_id),
        CHECK (
          (state = 'completed' AND result_json IS NOT NULL) OR
          (state != 'completed' AND result_json IS NULL)
        ),
        CHECK (state = 'outcome_unknown' OR contained = 0)
      ) STRICT;
    `);
    const columns = this.#database
      .prepare("PRAGMA table_info(sandbox_command_receipts)")
      .all();
    if (!columns.some((column) => column.name === "contained")) {
      this.#database.exec(
        `ALTER TABLE sandbox_command_receipts
         ADD COLUMN contained INTEGER NOT NULL DEFAULT 0
         CHECK (contained IN (0, 1))`,
      );
    }
  }

  #loadOrInitializeRealm(): void {
    const row = this.#database
      .prepare(
        "SELECT value FROM sandbox_command_metadata WHERE key = 'realm_id'",
      )
      .get();
    if (row === undefined) {
      this.#database
        .prepare(
          "INSERT INTO sandbox_command_metadata (key, value) VALUES ('realm_id', ?)",
        )
        .run(this.#realmId);
      return;
    }
    if (this.#text(row, "value") !== this.#realmId) {
      throw new Error("Sandbox command store belongs to a different Realm");
    }
  }

  #recoverPending(): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.exec(
        `UPDATE sandbox_command_receipts
         SET state = 'outcome_unknown'
         WHERE state = 'pending'`,
      );
      this.#database.exec("COMMIT");
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
