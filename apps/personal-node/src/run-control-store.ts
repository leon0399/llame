import { chmodSync, existsSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import {
  InMemoryRunControl,
  parseRunCommandInput,
  parseRunControlEvent,
  type RunCommand,
  type RunCommandInput,
  type RunControlEvent,
  type RunControlOptions,
  type RunControlSnapshot,
} from "@workspace/federation-experiment/run-control";
import {
  InMemoryWorkspaceRecovery,
  type WorkspaceRecoveryPolicy,
  type WorkspaceRecoveryState,
  type WorkspaceRecoveryTransition,
} from "@workspace/federation-experiment/workspace-recovery";

export interface SqliteRunControlStoreOptions {
  readonly databasePath: string;
  readonly realmId: string;
}

function requireText(
  row: Record<string, SQLOutputValue>,
  column: string,
): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`invalid Run control ${column}`);
  }
  return value;
}

function requireInteger(
  row: Record<string, SQLOutputValue>,
  column: string,
): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`invalid Run control ${column}`);
  }
  return value;
}

function parseJson(input: string): unknown {
  try {
    const parsed: unknown = JSON.parse(input);
    return parsed;
  } catch {
    throw new Error("invalid Run control JSON");
  }
}

export class SqliteRunControlStore {
  readonly #database: DatabaseSync;
  readonly #databasePath: string;
  readonly #realmId: string;

  public constructor(options: SqliteRunControlStoreOptions) {
    if (
      options.databasePath.length === 0 ||
      options.databasePath === ":memory:"
    ) {
      throw new Error("Run control store requires a durable database path");
    }
    this.#databasePath = options.databasePath;
    this.#realmId = options.realmId;
    this.#database = new DatabaseSync(options.databasePath);
    try {
      this.#initializeSchema();
      this.#loadOrInitializeRealm();
      this.#secureDatabaseFiles();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  public createRun(options: Omit<RunControlOptions, "realmId">): {
    readonly status: "created" | "already-created";
  } {
    const candidate = new InMemoryRunControl({
      ...options,
      realmId: this.#realmId,
    }).snapshot();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#database
        .prepare(
          `SELECT executor_node_id, authority_epoch
           FROM run_control_runs WHERE run_id = ?`,
        )
        .get(candidate.runId);
      if (existing !== undefined) {
        if (
          requireText(existing, "executor_node_id") !==
            candidate.executorNodeId ||
          requireInteger(existing, "authority_epoch") !==
            candidate.authorityEpoch
        ) {
          throw new Error("Run identity reused with different authority");
        }
        this.#database.exec("COMMIT");
        return { status: "already-created" };
      }
      this.#database
        .prepare(
          `INSERT INTO run_control_runs
            (realm_id, run_id, executor_node_id, authority_epoch, status)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          candidate.realmId,
          candidate.runId,
          candidate.executorNodeId,
          candidate.authorityEpoch,
          candidate.status,
        );
      this.#database.exec("COMMIT");
      this.#secureDatabaseFiles();
      return { status: "created" };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public appendExecutorEvent(
    input: unknown,
  ): ReturnType<InMemoryRunControl["appendExecutorEvent"]> {
    const event = parseRunControlEvent(input);
    return this.#write(event.runId, (run) => {
      const result = run.appendExecutorEvent(event);
      if (result.status === "applied") this.#insertEvent(event);
      this.#updateRun(run.snapshot());
      return result;
    });
  }

  public transferAuthority(
    runId: string,
    input: Parameters<InMemoryRunControl["transferAuthority"]>[0],
  ): RunControlEvent {
    return this.#write(runId, (run) => {
      const event = run.transferAuthority(input);
      this.#insertEvent(event);
      this.#updateRun(run.snapshot());
      return event;
    });
  }

  public submitCommand(
    input: unknown,
  ): ReturnType<InMemoryRunControl["submitCommand"]> {
    const command = parseRunCommandInput(input);
    return this.#write(command.runId, (run) => {
      const result = run.submitCommand(command);
      if (result.status === "accepted") {
        this.#database
          .prepare(
            `INSERT INTO run_control_commands
              (run_id, command_sequence, command_id, payload_json)
             VALUES (?, ?, ?, ?)`,
          )
          .run(
            command.runId,
            result.commandSequence,
            command.commandId,
            JSON.stringify(command),
          );
      }
      return result;
    });
  }

  public snapshot(runId: string, afterSequence = 0): RunControlSnapshot {
    this.#database.exec("BEGIN");
    try {
      const snapshot = this.#loadRun(runId).snapshot(afterSequence);
      this.#database.exec("COMMIT");
      return snapshot;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public commandsAfter(
    runId: string,
    commandSequence: number,
  ): readonly RunCommand[] {
    this.#database.exec("BEGIN");
    try {
      const commands = this.#loadRun(runId).commandsAfter(commandSequence);
      this.#database.exec("COMMIT");
      return commands;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public createWorkspaceAffinity(
    runId: string,
    options: {
      readonly workspaceId: string;
      readonly policy: WorkspaceRecoveryPolicy;
    },
  ): WorkspaceRecoveryState {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const run = this.#loadRun(runId);
      const runSnapshot = run.snapshot();
      const recovery = new InMemoryWorkspaceRecovery({
        workspaceId: options.workspaceId,
        preferredExecutorNodeId: runSnapshot.executorNodeId,
        authorityEpoch: runSnapshot.authorityEpoch,
        policy: options.policy,
      });
      const state = recovery.state();
      const existing = this.#database
        .prepare(
          "SELECT state_json FROM run_workspace_affinities WHERE run_id = ?",
        )
        .get(runId);
      if (existing !== undefined) {
        const storedState = parseJson(requireText(existing, "state_json"));
        if (JSON.stringify(storedState) !== JSON.stringify(state)) {
          throw new Error("Run already has a different Workspace affinity");
        }
        this.#database.exec("COMMIT");
        return state;
      }
      this.#database
        .prepare(
          `INSERT INTO run_workspace_affinities
            (run_id, workspace_id, preferred_executor_node_id,
             initial_authority_epoch, policy, state_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          state.workspaceId,
          state.preferredExecutorNodeId,
          state.authorityEpoch,
          state.policy,
          JSON.stringify(state),
        );
      this.#database.exec("COMMIT");
      this.#secureDatabaseFiles();
      return state;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public executorUnavailable(
    runId: string,
    context: unknown,
  ): WorkspaceRecoveryTransition {
    return this.#workspaceWrite(
      runId,
      "executor-unavailable",
      context,
      (recovery) => recovery.executorUnavailable(context),
    );
  }

  public chooseWorkspaceRecovery(
    runId: string,
    action: unknown,
    context: unknown,
  ): WorkspaceRecoveryTransition {
    return this.#workspaceWrite(
      runId,
      "choice",
      { action, context },
      (recovery) => recovery.choose(action, context),
    );
  }

  public preferredExecutorRecovered(
    runId: string,
  ): WorkspaceRecoveryTransition {
    return this.#workspaceWrite(runId, "preferred-recovered", {}, (recovery) =>
      recovery.preferredExecutorRecovered(),
    );
  }

  public exitWorkspace(runId: string): WorkspaceRecoveryTransition {
    return this.#workspaceWrite(runId, "explicit-exit", {}, (recovery) =>
      recovery.exitWorkspace(),
    );
  }

  public workspaceRecoveryState(runId: string): WorkspaceRecoveryState {
    this.#database.exec("BEGIN");
    try {
      const state = this.#loadWorkspaceRecovery(runId).state();
      this.#database.exec("COMMIT");
      return state;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public workspaceRecoveryStateIfPresent(
    runId: string,
  ): WorkspaceRecoveryState | null {
    const row = this.#database
      .prepare("SELECT 1 FROM run_workspace_affinities WHERE run_id = ?")
      .get(runId);
    return row === undefined ? null : this.workspaceRecoveryState(runId);
  }

  public close(): void {
    this.#database.close();
  }

  #write<Result>(
    runId: string,
    operation: (run: InMemoryRunControl) => Result,
  ): Result {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation(this.#loadRun(runId));
      this.#database.exec("COMMIT");
      this.#secureDatabaseFiles();
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #workspaceWrite(
    runId: string,
    kind:
      | "executor-unavailable"
      | "choice"
      | "preferred-recovered"
      | "explicit-exit",
    payload: unknown,
    operation: (
      recovery: InMemoryWorkspaceRecovery,
    ) => WorkspaceRecoveryTransition,
  ): WorkspaceRecoveryTransition {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const run = this.#loadRun(runId);
      const recovery = this.#loadWorkspaceRecovery(runId);
      const transition = operation(recovery);
      for (const effect of transition.effects) {
        if (effect.type !== "transfer-run-authority") continue;
        const authorityEvent = run.transferAuthority({
          expectedAuthorityEpoch: effect.expectedAuthorityEpoch,
          targetExecutorNodeId: effect.targetExecutorNodeId,
          reason: effect.reason,
        });
        if (authorityEvent.authorityEpoch !== effect.nextAuthorityEpoch) {
          throw new Error("Workspace recovery authority effect diverged");
        }
        this.#insertEvent(authorityEvent);
      }
      const runSnapshot = run.snapshot();
      if (
        runSnapshot.authorityEpoch !== transition.state.authorityEpoch ||
        runSnapshot.executorNodeId !== transition.state.activeExecutorNodeId
      ) {
        throw new Error("Workspace recovery and Run authority diverged");
      }
      this.#updateRun(runSnapshot);
      const nextSequence =
        requireInteger(
          this.#database
            .prepare(
              `SELECT COUNT(*) AS event_count
               FROM run_workspace_recovery_events WHERE run_id = ?`,
            )
            .get(runId) ?? { event_count: 0 },
          "event_count",
        ) + 1;
      this.#database
        .prepare(
          `INSERT INTO run_workspace_recovery_events
            (run_id, sequence, kind, payload_json)
           VALUES (?, ?, ?, ?)`,
        )
        .run(runId, nextSequence, kind, JSON.stringify(payload));
      this.#database
        .prepare(
          "UPDATE run_workspace_affinities SET state_json = ? WHERE run_id = ?",
        )
        .run(JSON.stringify(transition.state), runId);
      this.#database.exec("COMMIT");
      this.#secureDatabaseFiles();
      return transition;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #loadRun(runId: string): InMemoryRunControl {
    const row = this.#database
      .prepare(
        `SELECT realm_id, run_id, executor_node_id, authority_epoch
         FROM run_control_runs WHERE realm_id = ? AND run_id = ?`,
      )
      .get(this.#realmId, runId);
    if (row === undefined) throw new Error("Run control state not found");
    const run = new InMemoryRunControl({
      realmId: requireText(row, "realm_id"),
      runId: requireText(row, "run_id"),
      executorNodeId: this.#initialExecutorNodeId(runId),
    });
    const eventRows = this.#database
      .prepare(
        `SELECT payload_json FROM run_control_events
         WHERE run_id = ? ORDER BY sequence`,
      )
      .all(runId);
    const commandRows = this.#database
      .prepare(
        `SELECT command_sequence, payload_json FROM run_control_commands
         WHERE run_id = ? ORDER BY command_sequence`,
      )
      .all(runId);
    let commandIndex = 0;
    const replayCommandsForEpoch = (authorityEpoch: number): void => {
      while (commandIndex < commandRows.length) {
        const commandRow = commandRows[commandIndex];
        if (commandRow === undefined) break;
        const input = parseRunCommandInput(
          parseJson(requireText(commandRow, "payload_json")),
        );
        if (input.authorityEpoch > authorityEpoch) break;
        if (input.authorityEpoch < authorityEpoch) {
          throw new Error("stored Run command targets an invalid epoch");
        }
        const result = run.submitCommand(input);
        if (
          result.commandSequence !==
          requireInteger(commandRow, "command_sequence")
        ) {
          throw new Error("stored Run command sequence does not replay");
        }
        commandIndex += 1;
      }
    };
    for (const eventRow of eventRows) {
      const event = parseRunControlEvent(
        parseJson(requireText(eventRow, "payload_json")),
      );
      if (event.event.type === "authority-transferred") {
        replayCommandsForEpoch(event.authorityEpoch - 1);
        const replayed = run.transferAuthority({
          expectedAuthorityEpoch: event.authorityEpoch - 1,
          targetExecutorNodeId: event.executorNodeId,
          reason: event.event.reason,
        });
        if (JSON.stringify(replayed) !== JSON.stringify(event)) {
          throw new Error("stored Run authority event does not replay");
        }
      } else {
        run.appendExecutorEvent(event);
      }
    }
    replayCommandsForEpoch(run.snapshot().authorityEpoch);
    if (commandIndex !== commandRows.length) {
      throw new Error("stored Run commands do not replay");
    }
    const snapshot = run.snapshot();
    if (
      snapshot.executorNodeId !== requireText(row, "executor_node_id") ||
      snapshot.authorityEpoch !== requireInteger(row, "authority_epoch")
    ) {
      throw new Error("stored Run authority metadata does not replay");
    }
    return run;
  }

  #initialExecutorNodeId(runId: string): string {
    const firstEvent = this.#database
      .prepare(
        `SELECT payload_json FROM run_control_events
         WHERE run_id = ? ORDER BY sequence LIMIT 1`,
      )
      .get(runId);
    if (firstEvent === undefined) {
      const row = this.#database
        .prepare(
          "SELECT executor_node_id FROM run_control_runs WHERE run_id = ?",
        )
        .get(runId);
      if (row === undefined) throw new Error("Run control state not found");
      return requireText(row, "executor_node_id");
    }
    const event = parseRunControlEvent(
      parseJson(requireText(firstEvent, "payload_json")),
    );
    return event.event.type === "authority-transferred"
      ? event.event.previousExecutorNodeId
      : event.executorNodeId;
  }

  #loadWorkspaceRecovery(runId: string): InMemoryWorkspaceRecovery {
    const row = this.#database
      .prepare(
        `SELECT workspace_id, preferred_executor_node_id,
                initial_authority_epoch, policy, state_json
         FROM run_workspace_affinities WHERE run_id = ?`,
      )
      .get(runId);
    if (row === undefined) throw new Error("Run has no Workspace affinity");
    const policy = requireText(row, "policy");
    if (
      policy !== "ask" &&
      policy !== "wait" &&
      policy !== "fallback" &&
      policy !== "exit"
    ) {
      throw new Error("invalid Workspace recovery policy");
    }
    const recovery = new InMemoryWorkspaceRecovery({
      workspaceId: requireText(row, "workspace_id"),
      preferredExecutorNodeId: requireText(row, "preferred_executor_node_id"),
      authorityEpoch: requireInteger(row, "initial_authority_epoch"),
      policy,
    });
    const eventRows = this.#database
      .prepare(
        `SELECT kind, payload_json FROM run_workspace_recovery_events
         WHERE run_id = ? ORDER BY sequence`,
      )
      .all(runId);
    for (const eventRow of eventRows) {
      const kind = requireText(eventRow, "kind");
      const payload = parseJson(requireText(eventRow, "payload_json"));
      if (kind === "executor-unavailable") {
        recovery.executorUnavailable(payload);
      } else if (kind === "preferred-recovered") {
        recovery.preferredExecutorRecovered();
      } else if (kind === "choice") {
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("action" in payload) ||
          !("context" in payload)
        ) {
          throw new Error("invalid stored Workspace recovery choice");
        }
        recovery.choose(payload.action, payload.context);
      } else if (kind === "explicit-exit") {
        recovery.exitWorkspace();
      } else {
        throw new Error("invalid stored Workspace recovery event");
      }
    }
    if (
      JSON.stringify(recovery.state()) !==
      JSON.stringify(parseJson(requireText(row, "state_json")))
    ) {
      throw new Error("stored Workspace recovery state does not replay");
    }
    return recovery;
  }

  #insertEvent(event: RunControlEvent): void {
    this.#database
      .prepare(
        `INSERT INTO run_control_events
          (run_id, sequence, event_id, payload_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(event.runId, event.sequence, event.eventId, JSON.stringify(event));
  }

  #updateRun(snapshot: RunControlSnapshot): void {
    this.#database
      .prepare(
        `UPDATE run_control_runs
         SET executor_node_id = ?, authority_epoch = ?, status = ?
         WHERE realm_id = ? AND run_id = ?`,
      )
      .run(
        snapshot.executorNodeId,
        snapshot.authorityEpoch,
        snapshot.status,
        snapshot.realmId,
        snapshot.runId,
      );
  }

  #initializeSchema(): void {
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS run_control_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS run_control_runs (
        realm_id TEXT NOT NULL,
        run_id TEXT PRIMARY KEY,
        executor_node_id TEXT NOT NULL,
        authority_epoch INTEGER NOT NULL CHECK (authority_epoch > 0),
        status TEXT NOT NULL
          CHECK (status IN ('queued', 'running', 'paused', 'completed',
                            'failed', 'cancelled'))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS run_control_events (
        run_id TEXT NOT NULL REFERENCES run_control_runs(run_id),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        event_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence),
        UNIQUE (run_id, event_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS run_control_commands (
        run_id TEXT NOT NULL REFERENCES run_control_runs(run_id),
        command_sequence INTEGER NOT NULL CHECK (command_sequence > 0),
        command_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (run_id, command_sequence),
        UNIQUE (run_id, command_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS run_workspace_affinities (
        run_id TEXT PRIMARY KEY REFERENCES run_control_runs(run_id),
        workspace_id TEXT NOT NULL,
        preferred_executor_node_id TEXT NOT NULL,
        initial_authority_epoch INTEGER NOT NULL
          CHECK (initial_authority_epoch > 0),
        policy TEXT NOT NULL CHECK (policy IN ('ask', 'wait', 'fallback', 'exit')),
        state_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS run_workspace_recovery_events (
        run_id TEXT NOT NULL REFERENCES run_workspace_affinities(run_id),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        kind TEXT NOT NULL
          CHECK (kind IN ('executor-unavailable', 'choice',
                          'preferred-recovered', 'explicit-exit')),
        payload_json TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence)
      ) STRICT;
    `);
    const recoveryEventsSchema = this.#database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'run_workspace_recovery_events'",
      )
      .get()?.sql;
    if (
      typeof recoveryEventsSchema === "string" &&
      !recoveryEventsSchema.includes("explicit-exit")
    ) {
      this.#database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE run_workspace_recovery_events
          RENAME TO run_workspace_recovery_events_legacy;
        CREATE TABLE run_workspace_recovery_events (
          run_id TEXT NOT NULL REFERENCES run_workspace_affinities(run_id),
          sequence INTEGER NOT NULL CHECK (sequence > 0),
          kind TEXT NOT NULL
            CHECK (kind IN ('executor-unavailable', 'choice',
                            'preferred-recovered', 'explicit-exit')),
          payload_json TEXT NOT NULL,
          PRIMARY KEY (run_id, sequence)
        ) STRICT;
        INSERT INTO run_workspace_recovery_events
          (run_id, sequence, kind, payload_json)
          SELECT run_id, sequence, kind, payload_json
          FROM run_workspace_recovery_events_legacy;
        DROP TABLE run_workspace_recovery_events_legacy;
        COMMIT;
      `);
    }
  }

  #loadOrInitializeRealm(): void {
    const row = this.#database
      .prepare("SELECT value FROM run_control_metadata WHERE key = 'realm_id'")
      .get();
    if (row === undefined) {
      this.#database
        .prepare(
          "INSERT INTO run_control_metadata (key, value) VALUES ('realm_id', ?)",
        )
        .run(this.#realmId);
      return;
    }
    if (requireText(row, "value") !== this.#realmId) {
      throw new Error("Run control store belongs to a different Realm");
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
