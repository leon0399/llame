import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, test } from "vitest";

import {
  SandboxCommandConflictError,
  SqliteSandboxCommandStore,
} from "./sandbox-command-store.js";

const command = {
  realmId: "realm-personal",
  runId: "run-1",
  executorNodeId: "node-workstation",
  authorityEpoch: 3,
  commandId: "tool-call-1",
  request: { command: "git", args: ["status", "--short"] },
};
const result = {
  exitCode: 0,
  stdout: " M README.md\n",
  stderr: "",
};
const authority = {
  realmId: command.realmId,
  runId: command.runId,
  executorNodeId: command.executorNodeId,
  authorityEpoch: command.authorityEpoch,
};

describe("durable Sandbox command receipts", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function databasePath(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "llame-sandbox-command-"));
    temporaryDirectories.push(directory);
    return join(directory, "node.sqlite");
  }

  test("persists and replays one exact completed command", async () => {
    const path = await databasePath();
    const store = new SqliteSandboxCommandStore({
      databasePath: path,
      realmId: "realm-personal",
    });

    expect(store.reserve(command)).toEqual({ status: "reserved" });
    expect(store.reserve(command)).toEqual({ status: "in-progress" });
    expect(store.complete(command, result)).toEqual({
      status: "completed",
      runId: "run-1",
      commandId: "tool-call-1",
      executorNodeId: "node-workstation",
      authorityEpoch: 3,
      result,
    });
    expect(store.reserve(command)).toMatchObject({
      status: "completed",
      result,
    });
    store.close();

    const reopened = new SqliteSandboxCommandStore({
      databasePath: path,
      realmId: "realm-personal",
    });
    expect(reopened.reserve(command)).toMatchObject({
      status: "completed",
      result,
    });
    expect(reopened.complete(command, result)).toMatchObject({
      status: "completed",
      result,
    });
    reopened.close();
  });

  test.each([
    ["argv", { request: { command: "git", args: ["diff"] } }],
    ["executor", { executorNodeId: "node-other" }],
    ["authority epoch", { authorityEpoch: 4 }],
  ])("rejects command ID reuse with different %s", async (_name, override) => {
    const store = new SqliteSandboxCommandStore({
      databasePath: await databasePath(),
      realmId: "realm-personal",
    });
    store.reserve(command);

    expect(() => store.reserve({ ...command, ...override })).toThrowError(
      SandboxCommandConflictError,
    );
    store.close();
  });

  test("recovers an interrupted pending command as outcome_unknown", async () => {
    const path = await databasePath();
    const store = new SqliteSandboxCommandStore({
      databasePath: path,
      realmId: "realm-personal",
    });
    store.reserve(command);
    store.close();

    const reopened = new SqliteSandboxCommandStore({
      databasePath: path,
      realmId: "realm-personal",
    });
    expect(reopened.reserve(command)).toEqual({
      status: "outcome_unknown",
      runId: "run-1",
      commandId: "tool-call-1",
      executorNodeId: "node-workstation",
      authorityEpoch: 3,
    });
    expect(() => reopened.complete(command, result)).toThrowError(
      "Sandbox command outcome is already unknown",
    );
    reopened.close();
  });

  test("persists an explicitly ambiguous execution outcome", async () => {
    const path = await databasePath();
    const store = new SqliteSandboxCommandStore({
      databasePath: path,
      realmId: "realm-personal",
    });
    store.reserve(command);

    expect(store.markOutcomeUnknown(command)).toMatchObject({
      status: "outcome_unknown",
      commandId: "tool-call-1",
    });
    expect(store.markOutcomeUnknown(command)).toMatchObject({
      status: "outcome_unknown",
    });
    store.close();

    const reopened = new SqliteSandboxCommandStore({
      databasePath: path,
      realmId: "realm-personal",
    });
    expect(reopened.reserve(command)).toMatchObject({
      status: "outcome_unknown",
    });
    reopened.close();
  });

  test("persists authority activity without mutating ambiguous receipts", async () => {
    const path = await databasePath();
    const store = new SqliteSandboxCommandStore({
      databasePath: path,
      realmId: "realm-personal",
    });

    expect(store.authorityActivity(authority)).toBe("quiescent");
    store.reserve(command);
    expect(store.authorityActivity(authority)).toBe("in-progress");
    store.markOutcomeUnknown(command);
    expect(store.authorityActivity(authority)).toBe("outcome_unknown");
    expect(store.containOutcomeUnknown(authority)).toEqual({ contained: 1 });
    expect(store.authorityActivity(authority)).toBe("quiescent");
    expect(store.reserve(command)).toMatchObject({
      status: "outcome_unknown",
    });
    store.close();

    const reopened = new SqliteSandboxCommandStore({
      databasePath: path,
      realmId: "realm-personal",
    });
    expect(reopened.authorityActivity(authority)).toBe("quiescent");
    expect(reopened.reserve(command)).toMatchObject({
      status: "outcome_unknown",
    });
    reopened.close();
  });

  test("migrates receipts created before containment metadata existed", async () => {
    const path = await databasePath();
    const database = new DatabaseSync(path);
    database.exec(`
      CREATE TABLE sandbox_command_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      INSERT INTO sandbox_command_metadata (key, value)
      VALUES ('realm_id', 'realm-personal');
      CREATE TABLE sandbox_command_receipts (
        realm_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        executor_node_id TEXT NOT NULL,
        authority_epoch INTEGER NOT NULL CHECK (authority_epoch > 0),
        request_hash TEXT NOT NULL,
        state TEXT NOT NULL
          CHECK (state IN ('pending', 'completed', 'outcome_unknown')),
        result_json TEXT,
        PRIMARY KEY (run_id, command_id)
      ) STRICT;
      INSERT INTO sandbox_command_receipts (
        realm_id, run_id, command_id, executor_node_id, authority_epoch,
        request_hash, state, result_json
      ) VALUES (
        'realm-personal', 'run-1', 'tool-call-1', 'node-workstation', 3,
        'legacy-request-hash', 'outcome_unknown', NULL
      );
    `);
    database.close();

    const store = new SqliteSandboxCommandStore({
      databasePath: path,
      realmId: "realm-personal",
    });
    expect(store.authorityActivity(authority)).toBe("outcome_unknown");
    expect(store.containOutcomeUnknown(authority)).toEqual({ contained: 1 });
    expect(store.authorityActivity(authority)).toBe("quiescent");
    store.close();
  });

  test("keeps the first completed result immutable", async () => {
    const store = new SqliteSandboxCommandStore({
      databasePath: await databasePath(),
      realmId: "realm-personal",
    });
    store.reserve(command);
    store.complete(command, result);

    expect(() =>
      store.complete(command, { ...result, stdout: "different" }),
    ).toThrowError(SandboxCommandConflictError);
    store.close();
  });

  test("rejects invalid command definitions before persistence", async () => {
    const store = new SqliteSandboxCommandStore({
      databasePath: await databasePath(),
      realmId: "realm-personal",
    });

    expect(() =>
      store.reserve({
        ...command,
        commandId: "tool-call-invalid",
        request: { command: "", args: [] },
      }),
    ).toThrowError("invalid Sandbox command");
    store.close();
  });

  test("persists only the command hash rather than raw argv", async () => {
    const path = await databasePath();
    const store = new SqliteSandboxCommandStore({
      databasePath: path,
      realmId: "realm-personal",
    });
    const secret = "credential-that-must-not-persist";
    store.reserve({
      ...command,
      commandId: "tool-call-secret",
      request: { command: "provider-cli", args: ["--token", secret] },
    });
    store.close();

    const database = new DatabaseSync(path);
    const row = database
      .prepare("SELECT * FROM sandbox_command_receipts WHERE command_id = ?")
      .get("tool-call-secret");
    database.close();

    expect(JSON.stringify(row)).not.toContain(secret);
  });

  test("releases only a pending command that definitely did not start", async () => {
    const store = new SqliteSandboxCommandStore({
      databasePath: await databasePath(),
      realmId: "realm-personal",
    });
    store.reserve(command);

    expect(store.release(command)).toEqual({ status: "released" });
    expect(store.reserve(command)).toEqual({ status: "reserved" });
    store.complete(command, result);
    expect(() => store.release(command)).toThrowError(
      SandboxCommandConflictError,
    );
    store.close();
  });
});
