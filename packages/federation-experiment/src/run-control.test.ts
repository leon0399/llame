import { describe, expect, test } from "vitest";

import { InMemoryRunControl } from "./run-control.js";

describe("resumable Run control", () => {
  test("fences the prior executor after an authority transfer", () => {
    const run = new InMemoryRunControl({
      realmId: "realm-personal",
      runId: "run-1",
      executorNodeId: "node-workstation",
    });
    run.appendExecutorEvent({
      realmId: "realm-personal",
      runId: "run-1",
      executorNodeId: "node-workstation",
      authorityEpoch: 1,
      sequence: 1,
      eventId: "event-running",
      event: { type: "status", status: "running" },
    });

    const transferred = run.transferAuthority({
      expectedAuthorityEpoch: 1,
      targetExecutorNodeId: "node-fallback",
      reason: "fallback",
    });

    expect(transferred).toMatchObject({
      authorityEpoch: 2,
      executorNodeId: "node-fallback",
      sequence: 2,
      event: {
        type: "authority-transferred",
        previousExecutorNodeId: "node-workstation",
        reason: "fallback",
      },
    });
    expect(() =>
      run.appendExecutorEvent({
        realmId: "realm-personal",
        runId: "run-1",
        executorNodeId: "node-workstation",
        authorityEpoch: 1,
        sequence: 3,
        eventId: "event-stale",
        event: { type: "status", status: "completed" },
      }),
    ).toThrowError("executor does not hold current Run authority");
    expect(
      run.appendExecutorEvent({
        realmId: "realm-personal",
        runId: "run-1",
        executorNodeId: "node-fallback",
        authorityEpoch: 2,
        sequence: 3,
        eventId: "event-resumed",
        event: { type: "status", status: "running" },
      }).status,
    ).toBe("applied");
  });

  test("replays semantic state after a cursor without executor internals", () => {
    const run = new InMemoryRunControl({
      realmId: "realm-personal",
      runId: "run-1",
      executorNodeId: "node-workstation",
    });
    run.appendExecutorEvent({
      realmId: "realm-personal",
      runId: "run-1",
      executorNodeId: "node-workstation",
      authorityEpoch: 1,
      sequence: 1,
      eventId: "event-running",
      event: { type: "status", status: "running" },
    });
    run.appendExecutorEvent({
      realmId: "realm-personal",
      runId: "run-1",
      executorNodeId: "node-workstation",
      authorityEpoch: 1,
      sequence: 2,
      eventId: "event-output",
      event: {
        type: "assistant-output",
        messageId: "message-1",
        text: "Current semantic output",
      },
    });

    expect(run.snapshot(1)).toEqual({
      realmId: "realm-personal",
      runId: "run-1",
      executorNodeId: "node-workstation",
      authorityEpoch: 1,
      status: "running",
      cursor: 2,
      events: [
        {
          realmId: "realm-personal",
          runId: "run-1",
          executorNodeId: "node-workstation",
          authorityEpoch: 1,
          sequence: 2,
          eventId: "event-output",
          event: {
            type: "assistant-output",
            messageId: "message-1",
            text: "Current semantic output",
          },
        },
      ],
    });
    expect(run.snapshot(2).events).toEqual([]);
    expect(() =>
      run.appendExecutorEvent({
        realmId: "realm-personal",
        runId: "run-1",
        executorNodeId: "node-workstation",
        authorityEpoch: 1,
        sequence: 3,
        eventId: "event-output",
        event: { type: "status", status: "paused" },
      }),
    ).toThrowError("Run event identity reused at another sequence");
  });

  test("deduplicates steering and binds it to the targeted authority epoch", () => {
    const run = new InMemoryRunControl({
      realmId: "realm-personal",
      runId: "run-1",
      executorNodeId: "node-workstation",
    });
    const command = {
      realmId: "realm-personal",
      runId: "run-1",
      commandId: "command-1",
      authorityEpoch: 1,
      command: { type: "steer" as const, text: "Check the failing test first" },
    };

    expect(run.submitCommand(command)).toEqual({
      status: "accepted",
      commandSequence: 1,
    });
    expect(run.submitCommand(command)).toEqual({
      status: "already-accepted",
      commandSequence: 1,
    });
    expect(() =>
      run.submitCommand({
        ...command,
        command: { type: "cancel" },
      }),
    ).toThrowError("command identity reused with different payload");
    run.transferAuthority({
      expectedAuthorityEpoch: 1,
      targetExecutorNodeId: "node-fallback",
      reason: "fallback",
    });
    expect(() =>
      run.submitCommand({ ...command, commandId: "command-stale" }),
    ).toThrowError("command targets stale Run authority");
    expect(run.commandsAfter(0)).toEqual([{ ...command, commandSequence: 1 }]);
  });

  test("keeps terminal Run state immutable", () => {
    const run = new InMemoryRunControl({
      realmId: "realm-personal",
      runId: "run-1",
      executorNodeId: "node-workstation",
    });
    run.appendExecutorEvent({
      realmId: "realm-personal",
      runId: "run-1",
      executorNodeId: "node-workstation",
      authorityEpoch: 1,
      sequence: 1,
      eventId: "event-completed",
      event: { type: "status", status: "completed" },
    });

    expect(() =>
      run.appendExecutorEvent({
        realmId: "realm-personal",
        runId: "run-1",
        executorNodeId: "node-workstation",
        authorityEpoch: 1,
        sequence: 2,
        eventId: "event-reopened",
        event: { type: "status", status: "running" },
      }),
    ).toThrowError("terminal Run state is immutable");
    expect(() =>
      run.submitCommand({
        realmId: "realm-personal",
        runId: "run-1",
        commandId: "command-late",
        authorityEpoch: 1,
        command: { type: "steer", text: "Continue" },
      }),
    ).toThrowError("terminal Run cannot accept commands");
  });
});
