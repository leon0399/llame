import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUDGET_EXHAUSTED_MESSAGE,
  GIT_METHODS,
  INCOMPATIBLE_VERSION_MESSAGE,
  MAX_FRAME_BYTES,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  StreamClosedError,
} from "@workspace/machine-protocol";
import { createRootFixture, type RootFixture } from "./testing/fixtures";
import {
  envelope,
  isGone,
  startDaemon,
  waitFor,
  type TestDaemon,
} from "./testing/harness";

const NO_HANDSHAKE_MESSAGE =
  "The Machine session has not completed its handshake.";
const OVERSIZE_FRAME_MESSAGE =
  "The frame's message exceeds the byte bound of this protocol.";
const MALFORMED_FRAME_MESSAGE = "The frame is not a JSON-RPC message.";
const OVERSIZE_ANSWER_MESSAGE =
  "The Machine's answer exceeds the frame byte bound of this protocol.";

let fixture: RootFixture;
let daemon: TestDaemon;

beforeEach(async () => {
  fixture = await createRootFixture();
  daemon = startDaemon({ roots: [fixture.root] });
});

afterEach(async () => {
  daemon.input.end();
  await daemon.session.done;
  await fixture.cleanup();
});

function rawFrame(s: number, body: string): string {
  return `{"s":${s},"m":${body}}\n`;
}

function longCommand(pidFile: string): string {
  return `echo $$ > ${JSON.stringify(pidFile)}; sleep 30`;
}

async function startedPid(
  daemonUnderTest: TestDaemon,
  pidFile: string,
): Promise<number> {
  await waitFor(() => existsSync(pidFile), 5000);
  return Number(await readFile(pidFile, "utf8"));
}

describe("handshake", () => {
  it("answers hello with the protocol version, daemon version, roots, and methods", async () => {
    await expect(daemon.hello()).resolves.toEqual({
      ok: true,
      value: {
        protocolVersion: PROTOCOL_VERSION,
        daemonVersion: "0.0.1",
        roots: [fixture.root],
        methods: [...GIT_METHODS],
      },
    });
  });

  it("ends the session on an incompatible protocol version", async () => {
    const outcome = await daemon.hello(99);
    expect(outcome.ok).toBe(false);
    expect(daemon.frames).toEqual([
      {
        s: 0,
        m: {
          jsonrpc: "2.0",
          id: 0,
          error: {
            code: -32_003,
            message: INCOMPATIBLE_VERSION_MESSAGE,
            data: {
              code: "incompatible_version",
              hubProtocolVersion: 99,
              daemonProtocolVersion: PROTOCOL_VERSION,
            },
          },
        },
      },
    ]);
    await expect(daemon.session.done).resolves.toBe("incompatible_version");
  });

  it("refuses a request before the handshake", async () => {
    const outcome = await daemon.attempt("roots.list", {
      envelope: envelope(),
    });
    expect(outcome.error).toMatchObject({
      name: "MachineProtocolError",
      code: "internal",
      message: NO_HANDSHAKE_MESSAGE,
    });
  });

  it("refuses an unknown method as an internal error", async () => {
    await daemon.hello();
    daemon.write(
      rawFrame(7, '{"jsonrpc":"2.0","id":7,"method":"nope","params":{}}'),
    );
    await waitFor(() => daemon.frames.some((frame) => frame.s === 7));
    expect(daemon.frames.find((frame) => frame.s === 7)?.m).toMatchObject({
      error: { code: -32_603, data: { code: "internal" } },
    });
  });
});

describe("framing", () => {
  /** A stream the daemon is still serving, so it is open on both sides. */
  async function runningChannel(pidFile: string) {
    const { channel } = daemon.open();
    const running = channel
      .request("proc.bash", {
        envelope: envelope(),
        command: longCommand(pidFile),
        cwd: fixture.root,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    const pid = await startedPid(daemon, pidFile);
    return { channel, running, pid };
  }

  it("refuses an oversize message on a running stream and closes it", async () => {
    await daemon.hello();
    const { channel, running, pid } = await runningChannel(
      join(fixture.root, "oversize.pid"),
    );
    daemon.write(
      rawFrame(
        channel.id,
        JSON.stringify({
          jsonrpc: "2.0",
          id: channel.id,
          method: "fs.stat",
          params: {
            envelope: envelope(),
            path: `/${"x".repeat(MAX_MESSAGE_BYTES + 1)}`,
          },
        }),
      ),
    );
    expect(await running).toMatchObject({
      name: "MachineProtocolError",
      code: "invalid_params",
      message: OVERSIZE_FRAME_MESSAGE,
    });
    await waitFor(() => isGone(pid));
    const seen = daemon.frames.length;
    daemon.write(
      rawFrame(
        channel.id,
        '{"jsonrpc":"2.0","id":1,"method":"roots.list","params":{}}',
      ),
    );
    await daemon.call("roots.list", { envelope: envelope() });
    expect(daemon.frames).toHaveLength(seen + 1);
  });

  it("refuses a malformed message on a running stream", async () => {
    await daemon.hello();
    const { channel, running } = await runningChannel(
      join(fixture.root, "malformed.pid"),
    );
    daemon.write(rawFrame(channel.id, '{"jsonrpc":"2.0","id":1,"method":123}'));
    expect(await running).toMatchObject({
      name: "MachineProtocolError",
      code: "invalid_params",
      message: MALFORMED_FRAME_MESSAGE,
    });
  });

  it("ends the session on a line past the frame bound", async () => {
    await daemon.hello();
    daemon.write("y".repeat(MAX_FRAME_BYTES + 1));
    await expect(daemon.session.done).resolves.toBe("protocol_error");
  });

  it("drops a frame for a stream it never opened", async () => {
    await daemon.hello();
    daemon.write(
      rawFrame(23, '{"jsonrpc":"2.0","id":23,"result":{"roots":[]}}'),
    );
    // A later request answered proves the dropped frame was already read.
    await daemon.call("roots.list", { envelope: envelope() });
    expect(daemon.frames.some((frame) => frame.s === 23)).toBe(false);
  });

  it("refuses an answer the frame bound cannot carry, on its own stream", async () => {
    const many = Array.from(
      { length: 60_000 },
      (_unused, index) => `/srv/root-${index}`,
    );
    const wordy = startDaemon({ roots: many });
    await wordy.hello();
    const outcome = await wordy.attempt("roots.list", { envelope: envelope() });
    expect(outcome.error).toMatchObject({
      code: "internal",
      message: OVERSIZE_ANSWER_MESSAGE,
    });
    wordy.input.end();
    await wordy.session.done;
  });
});

describe("budgets", () => {
  it("refuses an exhausted budget without starting anything", async () => {
    await daemon.hello();
    const marker = join(fixture.root, "marker.txt");
    const outcome = await daemon.attempt("proc.bash", {
      envelope: envelope(0),
      command: `touch ${JSON.stringify(marker)}`,
      cwd: fixture.root,
    });
    expect(outcome.error).toMatchObject({
      name: "MachineProtocolError",
      code: "budget_exhausted",
      message: BUDGET_EXHAUSTED_MESSAGE,
    });
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses a request without a whole-millisecond budget", async () => {
    await daemon.hello();
    daemon.write(
      rawFrame(
        41,
        '{"jsonrpc":"2.0","id":41,"method":"roots.list","params":{"envelope":{"budgetMs":1.5}}}',
      ),
    );
    await waitFor(() => daemon.frames.some((frame) => frame.s === 41));
    expect(daemon.frames.find((frame) => frame.s === 41)?.m).toEqual({
      jsonrpc: "2.0",
      id: 41,
      error: {
        code: -32_602,
        message: "roots.list: the envelope budget must be whole milliseconds",
        data: { code: "invalid_params" },
      },
    });
  });

  it("refuses a budget that runs out mid-command and kills its process group", async () => {
    await daemon.hello();
    const pidFile = join(fixture.root, "budget.pid");
    const running = daemon.attempt("proc.bash", {
      envelope: envelope(400),
      command: longCommand(pidFile),
      cwd: fixture.root,
    });
    const pid = await startedPid(daemon, pidFile);
    expect(isGone(pid)).toBe(false);
    const outcome = await running;
    expect(outcome.error).toMatchObject({ code: "budget_exhausted" });
    expect(isGone(pid)).toBe(true);
  });
});

describe("session end", () => {
  it("cancels an in-flight command when the caller cancels", async () => {
    await daemon.hello();
    const pidFile = join(fixture.root, "cancel.pid");
    const controller = new AbortController();
    const { channel } = daemon.open();
    const running = channel
      .request(
        "proc.bash",
        {
          envelope: envelope(),
          command: longCommand(pidFile),
          cwd: fixture.root,
        },
        { signal: controller.signal },
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    const pid = await startedPid(daemon, pidFile);
    controller.abort();
    expect(await running).toBeInstanceOf(StreamClosedError);
    await waitFor(() => isGone(pid));
    expect(
      daemon.frames.some(
        (frame) => frame.s === channel.id && "result" in frame.m,
      ),
    ).toBe(false);
  });

  it("kills a running command when the hub closes stdin", async () => {
    await daemon.hello();
    const pidFile = join(fixture.root, "eof.pid");
    const { channel } = daemon.open();
    void channel
      .request("proc.bash", {
        envelope: envelope(),
        command: longCommand(pidFile),
        cwd: fixture.root,
      })
      .catch(() => undefined);
    const pid = await startedPid(daemon, pidFile);
    expect(isGone(pid)).toBe(false);
    daemon.closeInput();
    await expect(daemon.session.done).resolves.toBe("input_ended");
    expect(isGone(pid)).toBe(true);
  });

  it("pings while the hub is silent and ends the session after three misses", async () => {
    const quiet = startDaemon({
      roots: [],
      heartbeatIntervalMs: 20,
      heartbeatMisses: 3,
    });
    await quiet.hello();
    await waitFor(() =>
      quiet.frames.some(
        (frame) => "method" in frame.m && frame.m.method === "ping",
      ),
    );
    await expect(quiet.session.done).resolves.toBe("heartbeat_lost");
  });

  it("kills a running command when heartbeats stop", async () => {
    const quiet = startDaemon({
      roots: [fixture.root],
      heartbeatIntervalMs: 20,
      heartbeatMisses: 3,
    });
    await quiet.hello();
    const pidFile = join(fixture.root, "heartbeat.pid");
    const { channel } = quiet.open();
    void channel
      .request("proc.bash", {
        envelope: envelope(),
        command: longCommand(pidFile),
        cwd: fixture.root,
      })
      .catch(() => undefined);
    const pid = await startedPid(quiet, pidFile);
    await expect(quiet.session.done).resolves.toBe("heartbeat_lost");
    expect(isGone(pid)).toBe(true);
  });

  it("stops on request and reports the reason", async () => {
    await daemon.hello();
    daemon.session.stop();
    await expect(daemon.session.done).resolves.toBe("closed");
    const frames = daemon.frames.length;
    daemon.write(
      rawFrame(
        31,
        '{"jsonrpc":"2.0","id":31,"method":"roots.list","params":{}}',
      ),
    );
    expect(daemon.frames).toHaveLength(frames);
  });
});
