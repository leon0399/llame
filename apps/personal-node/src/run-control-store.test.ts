import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { SqliteRunControlStore } from "./run-control-store.js";

describe("durable Run control store", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("rehydrates semantic events, authority, and pending commands", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-run-control-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "node.sqlite");
    const store = new SqliteRunControlStore({
      databasePath,
      realmId: "realm-personal",
    });
    store.createRun({ runId: "run-1", executorNodeId: "node-workstation" });
    store.appendExecutorEvent({
      realmId: "realm-personal",
      runId: "run-1",
      executorNodeId: "node-workstation",
      authorityEpoch: 1,
      sequence: 1,
      eventId: "event-running",
      event: { type: "status", status: "running" },
    });
    store.submitCommand({
      realmId: "realm-personal",
      runId: "run-1",
      commandId: "command-1",
      authorityEpoch: 1,
      command: { type: "steer", text: "Run the focused test" },
    });
    store.transferAuthority("run-1", {
      expectedAuthorityEpoch: 1,
      targetExecutorNodeId: "node-fallback",
      reason: "fallback",
    });
    store.close();

    const reopened = new SqliteRunControlStore({
      databasePath,
      realmId: "realm-personal",
    });

    expect(reopened.snapshot("run-1", 1)).toMatchObject({
      executorNodeId: "node-fallback",
      authorityEpoch: 2,
      status: "running",
      cursor: 2,
      events: [
        {
          sequence: 2,
          event: { type: "authority-transferred", reason: "fallback" },
        },
      ],
    });
    expect(reopened.commandsAfter("run-1", 0)).toEqual([
      {
        realmId: "realm-personal",
        runId: "run-1",
        commandId: "command-1",
        authorityEpoch: 1,
        command: { type: "steer", text: "Run the focused test" },
        commandSequence: 1,
      },
    ]);
    reopened.close();
  });

  test("rehydrates under the write lock before rejecting a stale executor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-run-control-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "node.sqlite");
    const first = new SqliteRunControlStore({
      databasePath,
      realmId: "realm-personal",
    });
    first.createRun({ runId: "run-1", executorNodeId: "node-workstation" });
    const stale = new SqliteRunControlStore({
      databasePath,
      realmId: "realm-personal",
    });
    first.transferAuthority("run-1", {
      expectedAuthorityEpoch: 1,
      targetExecutorNodeId: "node-fallback",
      reason: "fallback",
    });

    expect(() =>
      stale.appendExecutorEvent({
        realmId: "realm-personal",
        runId: "run-1",
        executorNodeId: "node-workstation",
        authorityEpoch: 1,
        sequence: 2,
        eventId: "event-stale",
        event: { type: "status", status: "completed" },
      }),
    ).toThrowError("executor does not hold current Run authority");
    expect(stale.snapshot("run-1").executorNodeId).toBe("node-fallback");
    stale.close();
    first.close();
  });
});
