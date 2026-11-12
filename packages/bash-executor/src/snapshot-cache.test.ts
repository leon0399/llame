import { sanitizeKnownResultAtBound } from "./sanitize";
import { protectedValueIntervals } from "@workspace/runtime-safety";
import {
  emptySnapshotCache,
  emptySnapshotCaches,
  sanitizeSnapshot,
  snapshotOutput,
  type SnapshotOwner,
} from "./snapshot-cache";
import type { StreamBound } from "./output-bound";

const values = ["sk-secret-value", "tok", "\u{1F511}key\u{1F511}"];

const alphabet = [
  "sk-secret-value",
  "sk-sec",
  "ret-value",
  "tok",
  "t",
  "o",
  "k",
  "a",
  " ",
  "\n",
  "\u00e9",
  "\u{1F511}",
  "key",
  "\u{1F511}key\u{1F511}",
];

function sequence(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;

    return state;
  };
}

function full(raw: string, bound: StreamBound): string {
  return sanitizeKnownResultAtBound(
    {
      status: "success",
      exitCode: 0,
      stdout: raw,
      stderr: "",
      truncated: false,
    },
    bound,
    values,
    { stdout: { endedByLlame: true } },
  ).stdout;
}

describe("sanitizeSnapshot", () => {
  it.each([
    { kind: "code-units", limit: 400 },
    { kind: "bytes", limit: 700 },
    { kind: "bytes", limit: 100_000 },
  ] as const)(
    "matches the full routine at every step of a growing capture ($kind $limit)",
    (bound) => {
      for (let seed = 1; seed <= 25; seed += 1) {
        const next = sequence(seed);
        const cache = emptySnapshotCache();
        let raw = "";

        for (let step = 0; step < 60; step += 1) {
          // A piece may end inside a protected value or between surrogates.
          const piece = alphabet[next() % alphabet.length] ?? "";
          const cutAt = next() % (piece.length + 1);
          raw +=
            piece.slice(0, cutAt) +
            (next() % 3 === 0 ? "" : piece.slice(cutAt));

          const snapshot = sanitizeSnapshot(cache, raw, bound, values);

          expect(snapshot.text).toBe(full(raw, bound));
        }
      }
    },
  );

  it("keeps a credential that crosses the cached prefix redacted", () => {
    const cache = emptySnapshotCache();
    const bound: StreamBound = { kind: "bytes", limit: 10_000 };
    const head = `${"x".repeat(100)}sk-secret-`;
    const first = sanitizeSnapshot(cache, head, bound, values);

    expect(first.text).not.toContain("sk-secret");
    const second = sanitizeSnapshot(cache, `${head}value tail`, bound, values);

    expect(second.text).toContain(`${"x".repeat(100)}`);
    expect(second.text).not.toContain("secret");
    expect(cache.offset).toBeGreaterThan(0);
  });

  it("scans only the text after the cached prefix", () => {
    const cache = emptySnapshotCache();
    const bound: StreamBound = { kind: "bytes", limit: 100_000 };
    const raw = "y".repeat(50_000);
    sanitizeSnapshot(cache, raw, bound, values);

    // The cache stops one short of the longest member ("sk-secret-value").
    expect(cache.offset).toBe(raw.length - ("sk-secret-value".length - 1));
  });

  it("does not sanitize again while a capped capture is unchanged", () => {
    const bound: StreamBound = { kind: "bytes", limit: 64 };
    const cache = emptySnapshotCache();
    const raw = `${"z".repeat(200)}sk-secret-va`;
    const first = sanitizeSnapshot(cache, raw, bound, values);

    // The same result object comes back: the scan did not run again.
    for (let flush = 0; flush < 50; flush += 1)
      expect(sanitizeSnapshot(cache, raw, bound, values)).toBe(first);

    expect(first.truncated).toBe(true);
    // A change to the capture is scanned again and matches the full routine.
    const grown = `${raw}ue`;

    const next = sanitizeSnapshot(cache, grown, bound, values);

    expect(next).not.toBe(first);
    expect(next.text).toBe(full(grown, bound));
  });

  const sets = [
    { members: [] },
    { members: ["abcd"] },
    { members: ["ab", "\u{1F511}\u{1F511}"] },
    { members: ["aa", "aaaa"] },
    { members: ["\u{1F511}x\u{1F511}", "key"] },
  ];

  function expectEquivalent(
    cache: ReturnType<typeof emptySnapshotCache>,
    raw: string,
    bound: StreamBound,
    members: ReadonlyArray<string>,
  ): void {
    const got = sanitizeSnapshot(cache, raw, bound, members);

    const want = sanitizeKnownResultAtBound(
      {
        status: "success",
        exitCode: 0,
        stdout: raw,
        stderr: "",
        truncated: false,
      },
      bound,
      members,
      { stdout: { endedByLlame: true } },
    );

    expect(got.text).toBe(want.stdout);
    expect(got.truncated).toBe(want.truncated);

    // The cached offset sits on no interval and no surrogate pair.
    const high = raw.charCodeAt(cache.offset - 1);

    expect(high >= 0xd8_00 && high <= 0xdb_ff).toBe(false);

    for (const interval of protectedValueIntervals(raw, members))
      expect(
        cache.offset > interval.start && cache.offset <= interval.end,
      ).toBe(false);
  }

  it.each(sets)(
    "equals the full routine in text and truncated for $members",
    ({ members }) => {
      const pieces = [
        "a",
        "aa",
        "ab",
        "abcd",
        "\u{1F511}",
        "\u{1F511}\u{1F511}",
        "x",
        "key",
        "\n",
      ];

      const bounds: Array<StreamBound> = [
        { kind: "code-units", limit: 120 },
        { kind: "bytes", limit: 150 },
        { kind: "bytes", limit: 100_000 },
      ];

      for (const bound of bounds)
        for (let seed = 1; seed <= 15; seed += 1) {
          const next = sequence(seed);
          const cache = emptySnapshotCache();
          let raw = "";

          for (let step = 0; step < 50; step += 1) {
            raw += pieces[next() % pieces.length] ?? "";
            expectEquivalent(cache, raw, bound, members);
          }
        }
    },
  );

  it("advances over repeated credentials and astral output with an even longest member", () => {
    const bound: StreamBound = { kind: "bytes", limit: 1_000_000 };
    const cache = emptySnapshotCache();
    const raw = "\u{1F511}".repeat(500);

    sanitizeSnapshot(cache, raw, bound, ["abcd"]);
    expect(cache.offset).toBeGreaterThan(raw.length - 8);

    const run = "abcd".repeat(500);
    const cache2 = emptySnapshotCache();

    sanitizeSnapshot(cache2, `zz${run}`, bound, ["abcd"]);
    expect(cache2.offset).toBeGreaterThan(0);
  });
});

describe("snapshotOutput", () => {
  const context = {
    workingDirectory: process.cwd(),
    secretBoundary: true,
    processIsolation: true,
    outputBound: 4,
    inputBound: 256,
    durationMs: 20,
    maxProcesses: 1,
  };

  function owner(
    stdout: { text: string; lost?: boolean; used?: number },
    stderr: { text: string; lost?: boolean; used?: number },
  ): SnapshotOwner {
    return {
      snapshots: emptySnapshotCaches(),
      streams: {
        stdout: {
          text: stdout.text,
          lost: stdout.lost ?? false,
          used: stdout.used ?? stdout.text.length,
        },
        stderr: {
          text: stderr.text,
          lost: stderr.lost ?? false,
          used: stderr.used ?? stderr.text.length,
        },
      },
      request: { context, options: {} },
    };
  }

  it.each([
    {
      name: "stdout-only sanitization cut",
      stdout: "abcde",
      stderr: "",
      flags: { stdout: true, stderr: false },
    },
    {
      name: "stderr-only sanitization cut",
      stdout: "",
      stderr: "abcde",
      flags: { stdout: false, stderr: true },
    },
  ])("matches the full sanitizer for $name", ({ stdout, stderr, flags }) => {
    const got = snapshotOutput(owner({ text: stdout }, { text: stderr }));

    const want = sanitizeKnownResultAtBound(
      {
        status: "success",
        exitCode: 0,
        stdout,
        stderr,
        truncatedStreams: { stdout: false, stderr: false },
        truncated: false,
      },
      { kind: "code-units", limit: context.outputBound },
      [],
      {
        stdout: { endedByLlame: true },
        stderr: { endedByLlame: true },
      },
    );

    expect(got).toEqual({
      stdout: want.stdout,
      stderr: want.stderr,
      truncated: want.truncated,
      truncatedStreams: want.truncatedStreams,
    });
    expect(got.truncatedStreams).toEqual(flags);
  });

  it("marks a lost capture even when sanitization itself fits the bound", () => {
    const got = snapshotOutput(
      owner({ text: "ok", lost: true, used: 2 }, { text: "", used: 0 }),
    );

    const want = sanitizeKnownResultAtBound(
      {
        status: "success",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        truncated: true,
        truncatedStreams: { stdout: true, stderr: false },
      },
      { kind: "code-units", limit: context.outputBound },
      [],
      {
        stdout: { endedByLlame: true },
        stderr: { endedByLlame: true },
      },
    );

    expect(got).toEqual({
      stdout: want.stdout,
      stderr: want.stderr,
      truncated: want.truncated,
      truncatedStreams: want.truncatedStreams,
    });
  });

  it("marks discarded over-bound capture bytes independently of sanitized text", () => {
    const got = snapshotOutput(
      owner({ text: "ok", used: 5 }, { text: "", used: 0 }),
    );

    expect(got).toEqual({
      stdout: "ok",
      stderr: "",
      truncated: true,
      truncatedStreams: { stdout: true, stderr: false },
    });
  });
});
