import { chmodSync, existsSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import {
  type AdvanceWriterEpochInput,
  InMemoryReplica,
  parseChangeBatch,
  parseRunControlWriterGrants,
  type RunControlWriterGrant,
  ChangeBatch,
  ChatBranch,
  ReplicaOptions,
} from "@workspace/federation-experiment";
import {
  parseSignedChangeBatch,
  type SignedChangeBatch,
  verifySignedChangeBatch,
} from "@workspace/federation-experiment/batch-signature";

export interface SqlitePersonalRealmStoreOptions extends ReplicaOptions {
  readonly databasePath: string;
  readonly trustedWriterKeys?: Readonly<Record<string, string>>;
}

type ReceiveResult = ReturnType<InMemoryReplica["receive"]>;

function containsRunControlOperation(batch: ChangeBatch): boolean {
  return batch.operations.some(
    (operation) =>
      operation.type === "create-run" ||
      operation.type === "append-run-event" ||
      operation.type === "submit-run-command" ||
      operation.type === "transfer-run-authority",
  );
}

function requireText(
  row: Record<string, SQLOutputValue>,
  column: string,
): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`invalid SQLite ${column}`);
  }
  return value;
}

function parseWriterEpochs(input: string): Readonly<Record<string, number>> {
  const parsed: unknown = JSON.parse(input);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("invalid stored writer epochs");
  }
  const epochs: Record<string, number> = {};
  for (const [writerStreamId, epoch] of Object.entries(parsed)) {
    if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch <= 0) {
      throw new Error("invalid stored writer epochs");
    }
    epochs[writerStreamId] = epoch;
  }
  return epochs;
}

function parseWriterEpochEvent(input: string): AdvanceWriterEpochInput {
  const parsed: unknown = JSON.parse(input);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("invalid stored writer epoch event");
  }
  const values = Object.entries(parsed);
  if (values.length !== 3) {
    throw new Error("invalid stored writer epoch event");
  }
  const event = Object.fromEntries(values);
  if (
    typeof event.writerStreamId !== "string" ||
    typeof event.expectedEpoch !== "number" ||
    !Number.isInteger(event.expectedEpoch) ||
    typeof event.nextEpoch !== "number" ||
    !Number.isInteger(event.nextEpoch)
  ) {
    throw new Error("invalid stored writer epoch event");
  }
  return {
    writerStreamId: event.writerStreamId,
    expectedEpoch: event.expectedEpoch,
    nextEpoch: event.nextEpoch,
  };
}

export class SqlitePersonalRealmStore {
  readonly #database: DatabaseSync;
  readonly #databasePath: string;
  readonly #realmId: string;
  readonly #trustedWriterKeys: Readonly<Record<string, string>>;
  #initialWriterEpochs: Readonly<Record<string, number>>;
  #initialRunControlGrants: Readonly<Record<string, RunControlWriterGrant>>;
  #replica: InMemoryReplica;
  #signedBatches: readonly SignedChangeBatch[];

  public constructor(options: SqlitePersonalRealmStoreOptions) {
    if (
      options.databasePath.length === 0 ||
      options.databasePath === ":memory:"
    ) {
      throw new Error("personal Realm store requires a durable database path");
    }
    this.#databasePath = options.databasePath;
    this.#database = new DatabaseSync(options.databasePath);
    this.#realmId = options.realmId;
    this.#trustedWriterKeys = { ...options.trustedWriterKeys };
    this.#initialWriterEpochs = { ...options.writerEpochs };
    this.#initialRunControlGrants = parseRunControlWriterGrants(
      options.runControlGrants ?? {},
      this.#initialWriterEpochs,
    );
    try {
      this.#initializeSchema();
      const storedOptions = this.#loadOrInitializeMetadata();
      this.#initialWriterEpochs = { ...storedOptions.writerEpochs };
      this.#initialRunControlGrants = parseRunControlWriterGrants(
        storedOptions.runControlGrants ?? {},
        this.#initialWriterEpochs,
      );
      this.#replica = this.#loadReplica(storedOptions);
      this.#signedBatches = this.#loadSignedBatches(this.#replica);
      this.#secureDatabaseFiles(options.databasePath);
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  public receive(batch: ChangeBatch): ReceiveResult {
    const candidate = parseChangeBatch(batch);
    if (containsRunControlOperation(candidate)) {
      throw new Error("replicated Run operations require a signed batch");
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#loadReplica(this.#replicaOptions());
      const result = current.receive(candidate);
      if (result.status === "applied") {
        this.#database
          .prepare(
            "INSERT INTO realm_events (kind, payload_json) VALUES ('batch', ?)",
          )
          .run(JSON.stringify(candidate));
      }
      this.#database.exec("COMMIT");
      this.#replica = current;
      this.#secureDatabaseFiles();
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      this.#replica = this.#loadReplica(this.#replicaOptions());
      throw error;
    }
  }

  public receiveSigned(input: unknown): ReceiveResult {
    const candidate = parseSignedChangeBatch(input);
    const batch = verifySignedChangeBatch(candidate, this.#trustedWriterKeys);
    const reference = `${batch.writerStreamId}:${batch.sequence}`;
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#loadReplica(this.#replicaOptions());
      const existing = this.#database
        .prepare("SELECT envelope_json FROM signed_batches WHERE batch_ref = ?")
        .get(reference);
      const result = current.receive(batch);
      if (existing === undefined) {
        const event = this.#database
          .prepare(
            "INSERT INTO realm_events (kind, payload_json) VALUES ('batch', ?)",
          )
          .run(JSON.stringify(batch));
        this.#database
          .prepare(
            `INSERT INTO signed_batches
              (batch_ref, writer_stream_id, sequence, event_ordinal, envelope_json)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            reference,
            batch.writerStreamId,
            batch.sequence,
            event.lastInsertRowid,
            JSON.stringify(candidate),
          );
      } else if (
        requireText(existing, "envelope_json") !== JSON.stringify(candidate)
      ) {
        throw new Error(
          "signed batch reference reused with different envelope",
        );
      }
      this.#database.exec("COMMIT");
      this.#replica = current;
      this.#signedBatches = this.#loadSignedBatches(current);
      this.#secureDatabaseFiles();
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      this.#replica = this.#loadReplica(this.#replicaOptions());
      this.#signedBatches = this.#loadSignedBatches(this.#replica);
      throw error;
    }
  }

  public frontier(): Readonly<Record<string, number>> {
    return this.#replica.frontier();
  }

  public realmId(): string {
    return this.#realmId;
  }

  public signedSyncAvailable(): boolean {
    return Object.keys(this.#trustedWriterKeys).length > 0;
  }

  public chatBranches(chatId: string): readonly ChatBranch[] {
    return this.#replica.chatBranches(chatId);
  }

  public runSnapshot(
    runId: string,
  ): ReturnType<InMemoryReplica["runSnapshot"]> {
    return this.#replica.runSnapshot(runId);
  }

  public runCommandsAfter(
    runId: string,
    commandSequence: number,
  ): ReturnType<InMemoryReplica["runCommandsAfter"]> {
    return this.#replica.runCommandsAfter(runId, commandSequence);
  }

  public exportMissing(
    peerFrontier: Readonly<Record<string, number>>,
  ): readonly ChangeBatch[] {
    return this.#replica.exportMissing(peerFrontier);
  }

  public exportSignedMissing(
    peerFrontier: Readonly<Record<string, number>>,
  ): readonly SignedChangeBatch[] {
    return this.#signedBatches
      .filter(
        ({ batch }) =>
          batch.sequence > (peerFrontier[batch.writerStreamId] ?? 0),
      )
      .map((batch) => structuredClone(batch));
  }

  public coverageAgainst(
    expectedFrontier: Readonly<Record<string, number>>,
  ): ReturnType<InMemoryReplica["coverageAgainst"]> {
    return this.#replica.coverageAgainst(expectedFrontier);
  }

  public advanceWriterEpoch(input: AdvanceWriterEpochInput): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#loadReplica(this.#replicaOptions());
      current.advanceWriterEpoch(input);
      this.#database
        .prepare(
          "INSERT INTO realm_events (kind, payload_json) VALUES ('writer-epoch', ?)",
        )
        .run(JSON.stringify(input));
      this.#database.exec("COMMIT");
      this.#replica = current;
      this.#secureDatabaseFiles();
    } catch (error) {
      this.#database.exec("ROLLBACK");
      this.#replica = this.#loadReplica(this.#replicaOptions());
      throw error;
    }
  }

  public close(): void {
    this.#database.close();
  }

  #initializeSchema(): void {
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS realm_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS realm_events (
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('batch', 'writer-epoch')),
        payload_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS signed_batches (
        batch_ref TEXT PRIMARY KEY,
        writer_stream_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        event_ordinal INTEGER NOT NULL UNIQUE
          REFERENCES realm_events(ordinal) ON DELETE CASCADE,
        envelope_json TEXT NOT NULL,
        UNIQUE (writer_stream_id, sequence)
      ) STRICT;
    `);
  }

  #loadOrInitializeMetadata(): ReplicaOptions {
    const rows = this.#database
      .prepare("SELECT key, value FROM realm_metadata")
      .all();
    if (rows.length === 0) {
      this.#database.exec("BEGIN IMMEDIATE");
      try {
        const insert = this.#database.prepare(
          "INSERT INTO realm_metadata (key, value) VALUES (?, ?)",
        );
        insert.run("realm_id", this.#realmId);
        insert.run(
          "initial_writer_epochs",
          JSON.stringify(this.#initialWriterEpochs),
        );
        insert.run(
          "initial_run_control_grants",
          JSON.stringify(this.#initialRunControlGrants),
        );
        this.#database.exec("COMMIT");
      } catch (error) {
        this.#database.exec("ROLLBACK");
        throw error;
      }
      return {
        realmId: this.#realmId,
        writerEpochs: this.#initialWriterEpochs,
        runControlGrants: this.#initialRunControlGrants,
      };
    }

    const metadata = new Map(
      rows.map((row) => [requireText(row, "key"), requireText(row, "value")]),
    );
    const storedRealmId = metadata.get("realm_id");
    const storedWriterEpochs = metadata.get("initial_writer_epochs");
    if (storedRealmId === undefined || storedWriterEpochs === undefined) {
      throw new Error("incomplete personal Realm metadata");
    }
    if (storedRealmId !== this.#realmId) {
      throw new Error("database belongs to a different Personal Realm");
    }
    const writerEpochs = parseWriterEpochs(storedWriterEpochs);
    return {
      realmId: storedRealmId,
      writerEpochs,
      runControlGrants: parseRunControlWriterGrants(
        JSON.parse(metadata.get("initial_run_control_grants") ?? "{}"),
        writerEpochs,
      ),
    };
  }

  #loadReplica(options: ReplicaOptions): InMemoryReplica {
    const replica = new InMemoryReplica(options);
    const rows = this.#database
      .prepare("SELECT kind, payload_json FROM realm_events ORDER BY ordinal")
      .all();
    for (const row of rows) {
      const kind = requireText(row, "kind");
      const payloadJson = requireText(row, "payload_json");
      if (kind === "batch") {
        const payload: unknown = JSON.parse(payloadJson);
        replica.receive(parseChangeBatch(payload));
        continue;
      }
      if (kind === "writer-epoch") {
        replica.advanceWriterEpoch(parseWriterEpochEvent(payloadJson));
        continue;
      }
      throw new Error(`unsupported stored Realm event: ${kind}`);
    }
    return replica;
  }

  #loadSignedBatches(replica: InMemoryReplica): readonly SignedChangeBatch[] {
    const rows = this.#database
      .prepare(
        `SELECT signed_batches.envelope_json
         FROM signed_batches
         JOIN realm_events
           ON realm_events.ordinal = signed_batches.event_ordinal
         ORDER BY realm_events.ordinal`,
      )
      .all();
    return rows.map((row) => {
      const payload: unknown = JSON.parse(requireText(row, "envelope_json"));
      const signed = parseSignedChangeBatch(payload);
      const batch = verifySignedChangeBatch(signed, this.#trustedWriterKeys);
      if (replica.receive(batch).status !== "already-applied") {
        throw new Error("signed batch has no durable Realm event");
      }
      return signed;
    });
  }

  #replicaOptions(): ReplicaOptions {
    return {
      realmId: this.#realmId,
      writerEpochs: this.#initialWriterEpochs,
      runControlGrants: this.#initialRunControlGrants,
    };
  }

  #secureDatabaseFiles(databasePath = this.#databasePath): void {
    for (const path of [
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
    ]) {
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  }
}
