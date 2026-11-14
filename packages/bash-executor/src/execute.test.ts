import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  CONFIGURED_TOOLS,
  admitManagedBash,
  BashProcessLimiter,
  executeManagedBash,
  isConfiguredTool,
  managedEnvironmentCollision,
  measureManagedInput,
  requireManagedBoundary,
  resolveConfiguredTool,
} from "./index";
import { isRecord, isString } from "@workspace/runtime-safety";
import type { BashExecutorContext } from "./types";

let limiter = new BashProcessLimiter(1);

const execute: typeof executeManagedBash = (input, context, options) =>
  executeManagedBash(input, context, { limiter, ...options });

function context(
  directory: string,
  overrides: Partial<BashExecutorContext> = {},
): BashExecutorContext {
  return {
    workingDirectory: directory,
    secretBoundary: true,
    processIsolation: true,
    outputBound: 256,
    inputBound: 512,
    durationMs: 2000,
    maxProcesses: 1,
    ...overrides,
  };
}

describe("managed executor contract", () => {
  let directory: string;

  beforeEach(async () => {
    limiter = new BashProcessLimiter(1);
    directory = await mkdtemp(join(tmpdir(), "bash-exec-"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    limiter = new BashProcessLimiter(1);
    await rm(directory, { recursive: true, force: true });
  });

  it("lists ordinary configured tools without a canonical editor", () => {
    expect([...CONFIGURED_TOOLS]).toEqual([
      "bash",
      "grep",
      "rg",
      "jq",
      "python",
      "python3",
    ]);
    expect(resolveConfiguredTool("bash")).toBe("bash");
    expect(resolveConfiguredTool("/bin/bash")).toBeNull();
    expect(resolveConfiguredTool("sed")).toBeNull();
    expect(isConfiguredTool("rg")).toBe(true);
  });

  it("stays unavailable when any required boundary is missing", async () => {
    expect(
      requireManagedBoundary(context(directory, { secretBoundary: false })),
    ).toMatchObject({ type: "boundary_missing" });

    const result = await execute(
      { command: "bash", args: ["-c", "printf ok"] },
      context(directory, { processIsolation: false }),
    );

    expect(result).toMatchObject({ type: "boundary_missing" });
  });

  it("runs a bounded allowlisted command in the trusted directory", async () => {
    await writeFile(join(directory, "note.txt"), "alpha\nbeta\n");

    const result = await execute(
      { command: "bash", args: ["-c", "printf hello"] },
      context(directory),
    );

    expect(result).toMatchObject({
      status: "success",
      exitCode: 0,
      stdout: "hello",
    });
  });

  it("carries the wall time and no constant operation fields", async () => {
    const result = await execute(
      { command: "bash", args: ["-c", "true"] },
      context(directory),
    );

    expect(result).toMatchObject({ status: "success", exitCode: 0 });

    if ("type" in result) throw new Error("Expected a known result");
    expect(result.wallTimeMs).toBeGreaterThanOrEqual(0);
    expect(result).not.toHaveProperty("operation");
    expect(result).not.toHaveProperty("executor");
  });

  it.each([
    { label: "relative", cwd: "nested" },
    { label: "absolute", cwd: "absolute" },
  ])("runs in a $label per-call cwd", async ({ cwd, label }) => {
    const nested = join(
      directory,
      label === "relative" ? "nested" : "absolute",
    );

    await mkdir(nested, { recursive: true });

    const result = await execute(
      {
        command: "python3",
        args: ["-c", "import os; print(os.path.basename(os.getcwd()))"],
        cwd: label === "relative" ? cwd : nested,
      },
      context(directory),
    );

    expect(result).toMatchObject({
      status: "success",
      stdout: `${basename(nested)}\n`,
    });
  });

  it("uses the host default directory when cwd is omitted", async () => {
    const result = await execute(
      {
        command: "python3",
        args: ["-c", "import os; print(os.path.basename(os.getcwd()))"],
      },
      context(directory),
    );

    expect(result).toMatchObject({
      status: "success",
      stdout: `${basename(directory)}\n`,
    });
  });

  it.each([
    { label: "missing", cwd: "missing" },
    { label: "regular file", cwd: "file.txt" },
    { label: "mode-000", cwd: "unenterable" },
  ])(
    "refuses an unusable $label cwd before admission",
    async ({ cwd, label }) => {
      if (label === "regular file")
        await writeFile(join(directory, cwd), "file");

      if (label === "mode-000") {
        await mkdir(join(directory, cwd));
        await chmod(join(directory, cwd), 0o000);
      }

      const result = await execute(
        { command: "bash", args: ["-c", "printf never"], cwd },
        context(directory),
      );

      expect(result).toMatchObject({
        status: "error",
        type: "unavailable",
      });

      if (result.status !== "error" || !("message" in result)) return;
      expect(result.message).toContain(JSON.stringify(cwd));

      if (label === "mode-000") await chmod(join(directory, cwd), 0o755);
      expect(
        await execute(
          { command: "bash", args: ["-c", "printf default"] },
          context(directory),
        ),
      ).toMatchObject({ status: "success", stdout: "default" });
    },
  );

  it("measures UTF-8 environment keys and values against inputBound", async () => {
    const result = await execute(
      {
        command: "bash",
        args: ["-c", "true"],
        env: { É: "😀" },
      },
      context(directory, { inputBound: 18 }),
    );

    expect(result).toMatchObject({
      type: "unavailable",
      message: "Command input exceeds the managed input bound.",
    });
  });

  it("passes only the declared base environment and additions", async () => {
    vi.stubEnv("LLAME_INHERITED_SENTINEL", "must-not-reach-child");

    const result = await execute(
      {
        command: "jq",
        args: ["-nr", "env | tojson | @base64"],
        env: { DECLARED_ADDITION: "declared" },
      },
      context(directory, { outputBound: 20_000 }),
    );

    expect(result).toMatchObject({ status: "success" });

    if (result.status !== "success") return;

    // SAFETY: JSON.parse returns any; asserting unknown keeps the value at the
    // parsing boundary until the record and string values are validated below.
    const parsed = JSON.parse(
      Buffer.from(result.stdout.trim(), "base64").toString("utf8"),
    ) as unknown;

    if (!isRecord(parsed))
      throw new Error("Child environment was not an object.");
    const entries = Object.entries(parsed);

    if (!entries.every(([, value]) => isString(value))) {
      throw new Error("Child environment contained a non-string value.");
    }

    const actual = Object.fromEntries(
      entries.filter((entry): entry is [string, string] => isString(entry[1])),
    );

    const expectedEntries: Array<[string, string]> = [
      ["PATH", process.env.PATH ?? "/usr/bin:/bin"],
      ["LANG", "C.UTF-8"],
      ["TERM", "dumb"],
      ["DECLARED_ADDITION", "declared"],
    ];

    for (const name of ["HOME", "TMPDIR", "USER", "LOGNAME"]) {
      const value = process.env[name];

      if (value !== undefined) expectedEntries.push([name, value]);
    }

    const expected = Object.fromEntries(expectedEntries);
    expect(actual).toEqual(expected);
    expect(actual).not.toHaveProperty("LLAME_INHERITED_SENTINEL");
  });

  it.each(["PATH", "LANG", "HOME", "TMPDIR", "USER", "LOGNAME", "TERM"])(
    "refuses env collision with managed base %s",
    async (name) => {
      const originalHome = name === "HOME" ? process.env.HOME : undefined;

      if (name === "HOME") delete process.env.HOME;

      try {
        const result = await execute(
          {
            command: "bash",
            args: ["-c", "printf never"],
            env: { [name]: "override" },
          },
          context(directory),
        );

        expect(result).toMatchObject({
          type: "unavailable",
        });

        if (result.status !== "error" || !("message" in result)) return;
        expect(result.message).toContain(name);
      } finally {
        if (name === "HOME") {
          if (originalHome === undefined) delete process.env.HOME;
          else process.env.HOME = originalHome;
        }
      }
    },
  );

  it("rejects oversized input and non-configured tools", async () => {
    const oversized = await execute(
      { command: "bash", args: ["-c", "x".repeat(600)] },
      context(directory, { inputBound: 32 }),
    );

    expect(oversized).toMatchObject({ type: "unavailable" });

    const denied = await execute(
      { command: "sed", args: ["-n", "1p"] },
      context(directory),
    );

    expect(denied).toMatchObject({ type: "unavailable" });
  });

  it("returns partial output when a deadline stops the process group", async () => {
    const result = await execute(
      {
        command: "bash",
        args: [
          "-c",
          "printf partial; printf diagnostic >&2; while true; do :; done",
        ],
      },
      context(directory, { durationMs: 100 }),
    );

    expect(result).toMatchObject({
      status: "error",
      type: "timed_out",
      durationMs: 100,
      stdout: "partial",
      stderr: "diagnostic",
      truncated: false,
    });
  });

  it("honours cancellation before completion", async () => {
    const controller = new AbortController();

    const pending = execute(
      { command: "bash", args: ["-c", "while true; do printf x; done"] },
      context(directory, { durationMs: 5000 }),
      { signal: controller.signal },
    );

    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ type: "cancelled" });
  });

  it("classifies the trusted timeout source separately from cancellation", async () => {
    const timeout = AbortSignal.timeout(100);

    const result = await execute(
      {
        command: "bash",
        args: ["-c", "printf partial; while true; do :; done"],
      },
      context(directory, { durationMs: 5000 }),
      {
        signal: timeout,
        timeoutSignal: timeout,
        timeoutMs: 100,
      },
    );

    expect(result).toMatchObject({
      type: "timed_out",
      durationMs: 100,
      stdout: "partial",
    });
  });

  it("keeps the managed duration as the maximum trusted deadline", async () => {
    const timeout = AbortSignal.timeout(100);

    const result = await execute(
      { command: "bash", args: ["-c", "while true; do :; done"] },
      context(directory, { durationMs: 25 }),
      { signal: timeout, timeoutSignal: timeout, timeoutMs: 100 },
    );

    expect(result).toMatchObject({ type: "timed_out", durationMs: 25 });
  });

  it("does not spawn after a deadline aborts while admission is held", async () => {
    const timeout = new AbortController();
    const input = { command: "bash", args: ["-c", "printf spawned"] };

    const admitted = admitManagedBash(input, context(directory), {
      signal: timeout.signal,
      timeoutSignal: timeout.signal,
      timeoutMs: 40,
    });

    if ("type" in admitted) throw new Error("Expected admission");
    timeout.abort();
    expect(await admitted.run()).toMatchObject({
      type: "timed_out",
      durationMs: 40,
      stdout: "",
    });
    expect(await execute(input, context(directory))).toMatchObject({
      status: "success",
      stdout: "spawned",
    });
  });

  it("returns a timeout before admission when its deadline already fired", async () => {
    const timeout = new AbortController();
    timeout.abort();

    const result = await execute(
      { command: "bash", args: ["-c", "printf never"] },
      context(directory),
      {
        signal: timeout.signal,
        timeoutSignal: timeout.signal,
        timeoutMs: 40,
      },
    );

    expect(result).toMatchObject({
      type: "timed_out",
      durationMs: 40,
      stdout: "",
    });
  });

  it("keeps caller cancellation distinct from an unexpired deadline", async () => {
    const cancellation = new AbortController();
    const timeout = new AbortController();

    const pending = execute(
      { command: "bash", args: ["-c", "while true; do :; done"] },
      context(directory, { durationMs: 5000 }),
      {
        signal: cancellation.signal,
        timeoutSignal: timeout.signal,
        timeoutMs: 1000,
      },
    );

    cancellation.abort();
    expect(await pending).toMatchObject({ type: "cancelled" });
  });

  it("returns a known refusal when the working directory vanished", async () => {
    const missing = join(directory, "missing");

    const result = await execute(
      { command: "bash", args: ["-c", "printf never"] },
      context(missing),
    );

    expect(result).toMatchObject({ type: "unavailable" });
  });

  it("returns a known refusal when spawn throws synchronously", async () => {
    const result = await execute(
      { command: "bash", args: ["-c", "printf \0"] },
      context(directory),
    );

    expect(result).toMatchObject({ type: "unavailable" });
  });

  it("admits without taking a process slot", async () => {
    const input = { command: "bash", args: ["-c", "printf admitted"] };
    const admitted = admitManagedBash(input, context(directory));

    if ("type" in admitted) throw new Error("Expected admission");
    const slot = limiter.tryAcquire();

    expect(slot).not.toBeNull();
    slot?.release();
    expect(await admitted.run()).toMatchObject({
      status: "success",
      stdout: "admitted",
    });
  });

  it("refuses a consumed admission while pending and after settlement", async () => {
    const admitted = admitManagedBash(
      { command: "bash", args: ["-c", "printf x >> executions.txt"] },
      context(directory),
      { toolCallId: "one-admission" },
    );

    if ("type" in admitted) throw new Error("Expected admission");
    const slot = limiter.tryAcquire();

    if (slot === null) throw new Error("Expected a process slot");

    try {
      const first = admitted.run();
      const second = admitted.run();
      const [initial, duplicate] = await Promise.all([first, second]);

      expect(initial).toMatchObject({ status: "success" });
      expect(duplicate).toMatchObject({ type: "unavailable" });
      expect(await admitted.run()).toMatchObject({ type: "unavailable" });
      expect(await readFile(join(directory, "executions.txt"), "utf8")).toBe(
        "x",
      );
    } finally {
      slot.release();
    }
  });

  it("cancels before spawn when aborted during durable recording", async () => {
    const controller = new AbortController();
    const input = { command: "bash", args: ["-c", "printf never"] };

    const admitted = admitManagedBash(input, context(directory), {
      signal: controller.signal,
    });

    if ("type" in admitted) throw new Error("Expected admission");
    controller.abort();
    expect(await admitted.run()).toMatchObject({ type: "cancelled" });
    expect(await execute(input, context(directory))).toMatchObject({
      status: "success",
      stdout: "never",
    });
  });

  it("takes its slot from the limiter that its caller passes", async () => {
    const input = { command: "bash", args: ["-c", "printf local"] };
    const slot = limiter.tryAcquire();

    if (slot === null) throw new Error("Expected a slot");
    expect(await execute(input, context(directory))).toMatchObject({
      type: "unavailable",
      message: "Managed process limit reached.",
    });
    slot.release();
    slot.release();
    // A second release frees nothing: the held slot below still fills the
    // single-process bound.
    const held = limiter.tryAcquire();

    if (held === null) throw new Error("Expected a slot");
    expect(limiter.tryAcquire()).toBeNull();
    held.release();
    expect(await execute(input, context(directory))).toMatchObject({
      status: "success",
      stdout: "local",
    });
  });

  it("counts per bound when a caller passes no limiter", async () => {
    const input = { command: "bash", args: ["-c", "sleep 0.2; printf done"] };

    const first = executeManagedBash(input, context(directory));
    const second = await executeManagedBash(input, context(directory));

    expect(second).toMatchObject({
      type: "unavailable",
      message: "Managed process limit reached.",
    });
    expect(await first).toMatchObject({ status: "success", stdout: "done" });
  });

  it("keeps a 3 MB stream whole under the default byte bound", async () => {
    const result = await execute(
      {
        command: "bash",
        args: ["-c", String.raw`head -c 3000000 /dev/zero | tr '\0' a`],
      },
      context(directory, { outputBoundBytes: 8_388_608 }),
    );

    expect(result).toMatchObject({ status: "success", truncated: false });

    if (result.status !== "success") return;
    expect(result.stdout).toHaveLength(3_000_000);
  });

  it("bounds a multibyte stream by bytes rather than code units", async () => {
    const result = await execute(
      { command: "bash", args: ["-c", "printf 'é%.0s' {1..20}"] },
      context(directory, { outputBoundBytes: 30 }),
    );

    expect(result).toMatchObject({ status: "success", truncated: true });

    if (result.status !== "success") return;
    expect(result.stdout).toBe("é".repeat(15));
    expect(Buffer.byteLength(result.stdout, "utf8")).toBe(30);
  });

  it("keeps a stream full once the byte cut lands short of the bound", async () => {
    // The first chunk is a two-byte character under a one-byte bound: the cut
    // keeps nothing, and the later ASCII chunk must not reopen the stream.
    const result = await execute(
      {
        command: "bash",
        args: ["-c", "printf '\u00e9'; sleep 0.05; printf x"],
      },
      context(directory, { outputBoundBytes: 1 }),
    );

    expect(result).toMatchObject({ status: "success", truncated: true });

    if (result.status !== "success") return;
    expect(result.stdout).toBe("");
  });

  it("keeps no byte after an exceeded bound reaches the result", async () => {
    const result = await execute(
      { command: "bash", args: ["-c", "printf abcdefghij"] },
      context(directory, { outputBoundBytes: 8 }),
    );

    expect(result).toMatchObject({ status: "success", truncated: true });

    if (result.status !== "success") return;
    expect(result.stdout).toBe("abcdefgh");
    expect(result.stdout).not.toContain("ij");
  });

  it("measures the command, argv, cwd, and additions as UTF-8 bytes", () => {
    expect(measureManagedInput({ command: "bash" })).toBe(4);
    expect(measureManagedInput({ command: "bash", args: ["-s"] })).toBe(7);
    expect(measureManagedInput({ command: "bash", cwd: "/tmp" })).toBe(9);
    expect(measureManagedInput({ command: "bash", env: { É: "😀" } })).toBe(12);
  });

  it("names a base variable an addition would replace", () => {
    expect(managedEnvironmentCollision({ PATH: "/tmp" })).toBe("PATH");
    expect(managedEnvironmentCollision({ TOKEN: "x" })).toBeUndefined();
  });
});
