import { decodeGrepCursor } from "./cursor";
import type { DecodedGrepCursor } from "./cursor";
import { memoryScope, runMemoryScan } from "./memory-port.test-fixture";
import { grepContinuationUnits } from "./cursor";
import { GrepPortError } from "./types";
import type { GrepEntry, GrepFileStream, GrepWalkPort } from "./types";

/** A page bound that leaves `room` units for passages beside the page's own. */
function reservedRoom(rel: string, room: number): number {
  return grepContinuationUnits({ scopeIndex: 0, rel, startLine: 1 }) + room;
}

/** One in-memory file a gated port hands over at the test's pace. */
type GatedFile = {
  /** The bytes the read delivers, in UTF-8. */
  readonly content: string;
  /** Bytes each chunk carries; the whole content by default. */
  readonly chunkBytes?: number;
  /** Thrown at open, as a Knowledge scope failure is. */
  readonly failure?: Error;
  /**
   * Chunks handed over before the read waits for the test: 0 holds the whole
   * file, a number holds the rest of it, undefined never holds.
   */
  readonly holdAfter?: number;
};

/** One file's read, and the latch that holds it until the test releases it. */
type GatedRead = {
  readonly latch: Latch;
  closed: boolean;
};

type Latch = {
  released: boolean;
  readonly waiters: Array<() => void>;
};

type GatedPort = GrepWalkPort & {
  /** Files whose read started, in the order the walk opened them. */
  readonly opened: Array<string>;
  /** Files whose stream closed, aborted ones included. */
  readonly closed: Array<string>;
  inFlight(): number;
  /** The most reads that ever held a file at the same time. */
  peak(): number;
  release(rel: string): void;
  releaseAll(): void;
  /** Resolves once `count` reads hold a file. */
  started(count: number): Promise<void>;
  /** Resolves once one file's stream closed. */
  closedFile(rel: string): Promise<void>;
};

/**
 * A port whose reads deliver their bytes only when the test lets them, so a
 * test can see the read-ahead window, the order a page keeps, and the reads a
 * stop discards. `onChunk` runs before each chunk, which is where a test
 * advances a fake clock.
 */
function createGatedPort(
  files: Readonly<Record<string, GatedFile>>,
  onChunk?: (rel: string, index: number) => void,
): GatedPort {
  const opened: Array<string> = [];
  const closed: Array<string> = [];
  const reads = new Map<string, GatedRead>();
  const releasedFiles = new Set<string>();
  const pending: Array<{ readonly ready: () => boolean; resolve: () => void }> =
    [];
  let inFlight = 0;
  let peak = 0;
  let allReleased = false;

  function notify(): void {
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const waiter = pending[index];
      if (!waiter.ready()) continue;
      pending.splice(index, 1);
      waiter.resolve();
    }
  }

  function until(ready: () => boolean): Promise<void> {
    return ready()
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          pending.push({ ready, resolve });
        });
  }

  function readOf(rel: string): GatedRead {
    return reads.get(rel) ?? newRead(rel);
  }

  function newRead(rel: string): GatedRead {
    const read: GatedRead = {
      latch: { released: allReleased || releasedFiles.has(rel), waiters: [] },
      closed: false,
    };
    reads.set(rel, read);
    return read;
  }

  function release(rel: string): void {
    releasedFiles.add(rel);
    const read = reads.get(rel);
    if (read === undefined) return;
    read.latch.released = true;
    for (const waiter of read.latch.waiters.splice(0)) waiter();
  }

  function close(rel: string): Promise<void> {
    const read = readOf(rel);
    if (read.closed) return Promise.resolve();
    read.closed = true;
    inFlight -= 1;
    closed.push(rel);
    // A closed read releases a test that still holds it, so a discarded file
    // never keeps the scan waiting.
    release(rel);
    notify();
    return Promise.resolve();
  }

  async function* chunksOf(
    rel: string,
    file: GatedFile,
  ): AsyncGenerator<Uint8Array> {
    const read = readOf(rel);
    const bytes = Buffer.from(file.content, "utf8");
    const width = file.chunkBytes ?? bytes.byteLength;
    try {
      for (
        let offset = 0, index = 0;
        offset < bytes.byteLength;
        offset += width
      ) {
        if (file.holdAfter !== undefined && index >= file.holdAfter)
          await new Promise<void>((resolve) =>
            read.latch.released ? resolve() : read.latch.waiters.push(resolve),
          );
        if (read.closed) return;
        onChunk?.(rel, index);
        yield bytes.subarray(offset, offset + width);
        index += 1;
      }
    } finally {
      await close(rel);
    }
  }

  return {
    followsLinks: false,
    opened,
    closed,
    inFlight: () => inFlight,
    peak: () => peak,
    release(rel) {
      release(rel);
    },
    releaseAll() {
      allReleased = true;
      for (const rel of Object.keys(files)) release(rel);
    },
    started: (count) => until(() => inFlight >= count),
    closedFile: (rel) => until(() => closed.includes(rel)),
    list(rel: string): Promise<ReadonlyArray<GrepEntry>> {
      const prefix = rel.length === 0 ? "" : `${rel}/`;
      const names = new Set<string>();
      const entries: Array<GrepEntry> = [];
      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const separator = rest.indexOf("/");
        const name = separator === -1 ? rest : rest.slice(0, separator);
        if (names.has(name)) continue;
        names.add(name);
        entries.push({ name, kind: separator === -1 ? "file" : "directory" });
      }
      return Promise.resolve(entries);
    },
    open(rel: string) {
      const file = files[rel];
      if (file === undefined) return Promise.resolve({ kind: "unreadable" });
      if (file.failure !== undefined) {
        opened.push(rel);
        return Promise.reject(file.failure);
      }
      // Each open starts its own read, so a file a second call opens again
      // streams its bytes again.
      newRead(rel);
      opened.push(rel);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      notify();
      return Promise.resolve<GrepFileStream>({
        size: Buffer.byteLength(file.content, "utf8"),
        close: () => close(rel),
        chunks: chunksOf(rel, file),
      });
    },
  };
}

/** Let the scan's own microtasks run; nothing else can advance it after this. */
async function settle(turns = 32): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

/** One cursor a test expects the scan to issue. */
function decode(cursor: string | undefined): DecodedGrepCursor {
  if (cursor === undefined) throw new Error("expected a cursor");
  const decoded = decodeGrepCursor(cursor, "input-hash");
  if ("error" in decoded) throw new Error(decoded.error);
  return decoded;
}

/** `count` files named f00.ts, f01.ts, … with one matching line each. */
function numberedFiles(
  count: number,
  file: GatedFile = { content: "hit\n" },
): Record<string, GatedFile> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `f${String(index).padStart(2, "0")}.ts`,
      file,
    ]),
  );
}

describe("grep read-ahead", () => {
  it("holds eight queued reads and never the whole tree", async () => {
    const port = createGatedPort(
      numberedFiles(200, { content: "hit\n", holdAfter: 0 }),
    );
    const run = runMemoryScan([memoryScope(0, "/repo/", port)], ["hit"]);
    await port.started(8);
    await settle();
    // Eight reads wait in the window, and the one the consumer took frees its
    // slot at take, so at most nine files are open while a slow head waits.
    expect(port.opened.length).toBeGreaterThanOrEqual(8);
    expect(port.opened.length).toBeLessThanOrEqual(9);
    port.releaseAll();
    const result = await run;
    expect(port.peak()).toBeLessThanOrEqual(9);
    expect(result.results).toHaveLength(20);
    expect(result.complete).toBe(false);
  });

  it("stops the read-ahead at the queued-event cap", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 10_100 }, (_, index) => [
        `f${String(index).padStart(5, "0")}.ts`,
        index === 0
          ? { content: "hit\n", holdAfter: 0 }
          : { content: "miss\n" },
      ]),
    );
    const port = createGatedPort(files);
    const asked: Array<string> = [];
    const run = runMemoryScan([memoryScope(0, "/repo/", port)], ["hit"], {
      onCandidate: (locator) => {
        asked.push(locator);
        // The head file is admitted and held; every later file is refused.
        return Promise.resolve(locator.endsWith("/f00000.ts"));
      },
    });
    // The consumer waits on the gated head while refused candidates fill the
    // queue; the count stops growing only when the cap parks the walk.
    let admitted = -1;
    for (let round = 0; round < 40 && asked.length !== admitted; round += 1) {
      admitted = asked.length;
      await settle(10_000);
    }
    // A refusal costs a record and a candidate, so the 10,000-event queue
    // parks the walk near 5,000 admitted files instead of all 10,100.
    expect(asked.length).toBeGreaterThan(4000);
    expect(asked.length).toBeLessThan(10_000 + 100);
    port.release("f00000.ts");
    await run;
  }, 30_000);

  it("keeps canonical order when a later file ends first", async () => {
    const port = createGatedPort({
      "a.ts": { content: "a hit\n", holdAfter: 0 },
      "b.ts": { content: "b hit\n", holdAfter: 0 },
    });
    const run = runMemoryScan([memoryScope(0, "/repo/", port)], ["hit"]);
    await port.started(2);
    port.release("b.ts");
    await port.closedFile("b.ts");
    port.release("a.ts");
    const result = await run;
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/a.ts:1-1",
      "/repo/b.ts:1-1",
    ]);
  });

  it("closes the files opened ahead of a stop", async () => {
    const files = {
      "a.ts": { content: "hit\n" },
      "b.ts": { content: "hit\n" },
      "c.ts": { content: "hit\n" },
      "d.ts": { content: "hit\n", holdAfter: 0 },
      "e.ts": { content: "hit\n", holdAfter: 0 },
    };
    const port = createGatedPort(files);
    const first = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      {
        budget: { limit: 3 },
      },
    );
    expect(first.complete).toBe(false);
    expect(first.results.map((passage) => passage.locator)).toEqual([
      "/repo/a.ts:1-1",
      "/repo/b.ts:1-1",
      "/repo/c.ts:1-1",
    ]);
    expect(decode(first.cursor)).toMatchObject({
      kind: "passage",
      rel: "c.ts",
    });
    // The read-ahead opened `d.ts` past the page; the stop released it.
    expect(port.closed).toContain("d.ts");
    expect([...port.closed].sort()).toEqual([...port.opened].sort());

    const again = createGatedPort(files);
    again.releaseAll();
    const second = await runMemoryScan(
      [memoryScope(0, "/repo/", again)],
      ["hit"],
      { cursor: decode(first.cursor) },
    );
    // The cursor's own file opens only to resume after the passage it names;
    // the files the stop discarded are opened again from their first line.
    expect(again.opened).toEqual(["c.ts", "d.ts", "e.ts"]);
    expect(second.results.map((passage) => passage.locator)).toEqual([
      "/repo/d.ts:1-1",
      "/repo/e.ts:1-1",
    ]);
  });

  it("opens no more files than the file bound leaves", async () => {
    const port = createGatedPort(numberedFiles(10));
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      { budget: { files: 3 } },
    );
    expect(port.opened).toEqual(["f00.ts", "f01.ts", "f02.ts"]);
    expect(result.results).toHaveLength(3);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([{ kind: "file_bound", count: 1 }]);
  });

  it("searches every file queued before an entry bound", async () => {
    const files = {
      "a.ts": { content: "miss\n" },
      "b.ts": { content: "miss\n" },
      "c.ts": { content: "miss\n" },
      "d.ts": { content: "hit\n" },
    };
    const port = createGatedPort(files);
    const first = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      {
        budget: { entries: 3 },
      },
    );
    expect(first.results).toEqual([]);
    expect(first.consumed.files).toBe(3);
    expect(first.complete).toBe(false);
    expect(first.warnings).toEqual([{ kind: "entry_bound", count: 1 }]);
    expect(decode(first.cursor)).toMatchObject({
      kind: "position",
      rel: "c.ts",
    });

    const again = createGatedPort(files);
    const second = await runMemoryScan(
      [memoryScope(0, "/repo/", again)],
      ["hit"],
      { cursor: decode(first.cursor) },
    );
    expect(again.opened).toEqual(["d.ts"]);
    expect(second.results.map((passage) => passage.locator)).toEqual([
      "/repo/d.ts:1-1",
    ]);
  });

  it("finds a match whose later pattern the byte bound crosses", async () => {
    const port = createGatedPort({
      "a.ts": { content: "hit\n" },
      "b.ts": { content: "hit\n" },
    });
    // The head file is one chunk exactly at the byte bound: the old probe cut
    // its first line's remaining patterns and silently lost the match.
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["zzz", "hit"],
      { budget: { bytes: 4 } },
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/a.ts:1-1",
    ]);
    expect(result.complete).toBe(false);
  });

  it("answers the page before a walk failure queued behind it", async () => {
    const first = createGatedPort({
      "a.ts": { content: "hit\n" },
      "b.ts": { content: "hit\n" },
    });
    const failing = {
      followsLinks: false,
      list: () => Promise.reject(new GrepPortError("later scope list failed")),
      open: () => Promise.resolve({ kind: "unreadable" as const }),
    };
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", first), memoryScope(1, "/later/", failing)],
      ["hit"],
      { budget: { limit: 1 } },
    );
    expect(result.results).toHaveLength(1);
    expect(result.complete).toBe(false);
  });

  it("stops a scan whose page filled before the next file", async () => {
    const long = createGatedPort({
      "a.ts": { content: "hit\n".repeat(30) },
      "b.ts": { content: "hit\n" },
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", long)],
      ["hit"],
      { budget: { pageUnits: reservedRoom("a.ts", 20) } },
    );
    // The page ends on the passage it could not hold whole; a later file's
    // small match must not follow it, or the cursor would skip it.
    expect(result.results).toHaveLength(1);
    expect(result.results[0].cut).toBe(true);
    expect(result.complete).toBe(false);
  });

  it("adds no bound warning when the page filled on the same file", async () => {
    const port = createGatedPort(numberedFiles(3));
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      { budget: { files: 2, limit: 2 } },
    );
    expect(result.results).toHaveLength(2);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("counts a read refusal only for the file it takes", async () => {
    let clock = 0;
    const asked: Array<string> = [];
    const port = createGatedPort({
      "a.ts": { content: "" },
      "p.ts": { content: "hit\n" },
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      {
        onCandidate: (locator) => {
          asked.push(locator);
          return Promise.resolve(!locator.endsWith("/p.ts"));
        },
        budget: { deadlineMs: 10 },
        now: () => (clock += 10),
      },
    );
    // The deadline passes between the first file's take and the refusal's.
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([{ kind: "deadline", count: 1 }]);
    expect(result.readRefused).toBe(0);
    expect(port.opened).toEqual(["a.ts"]);
    // The refusal was admitted ahead of the stop, so only the take can count it.
    expect(asked).toEqual(["/repo/a.ts", "/repo/p.ts"]);
  });

  it("never surfaces a failed read the call stopped before", async () => {
    const port = createGatedPort({
      "a.ts": { content: "hit\n" },
      "boom.ts": { content: "", failure: new Error("scope failed") },
      "held.ts": { content: "hit\n", holdAfter: 0 },
    });
    // The page fills on the first file, so the failing read is discarded; its
    // promise was caught where it was created, so nothing rejects unhandled.
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      { budget: { limit: 1 } },
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/a.ts:1-1",
    ]);
    expect(result.complete).toBe(false);
    // The failing open ran ahead of the stop; its caught outcome is discarded.
    expect(port.opened).toContain("boom.ts");
  });

  it("surfaces a failed read the call takes", async () => {
    const port = createGatedPort({
      "boom.ts": { content: "", failure: new Error("scope failed") },
    });
    await expect(
      runMemoryScan([memoryScope(0, "/repo/", port)], ["hit"]),
    ).rejects.toThrow("scope failed");
  });
});

describe("grep unfinished files", () => {
  it("discards the files opened ahead of a deadline stop", async () => {
    const clock = { value: 0 };
    const files = {
      "a.ts": { content: "miss\n" },
      "b.ts": { content: "miss\n" },
      "c.ts": { content: "miss\n" },
      "d.ts": { content: "miss\n", holdAfter: 0 },
      "e.ts": { content: "miss\n", holdAfter: 0 },
    } satisfies Record<string, GatedFile>;
    const port = createGatedPort(files);
    const run = runMemoryScan([memoryScope(0, "/repo/", port)], ["hit"], {
      budget: { deadlineMs: 10 },
      now: () => clock.value,
    });
    await settle(200);
    clock.value = 40;
    port.releaseAll();
    const first = await run;
    // The deadline stopped the walk at `d.ts`'s take; `d.ts` and `e.ts` were
    // opened ahead and released unread.
    expect(first.unfinished).toBeUndefined();
    expect(first.progressed).toBe(true);
    expect(first.complete).toBe(false);
    expect(port.closed).toEqual(expect.arrayContaining(["d.ts", "e.ts"]));
    const cursor = decode(first.cursor);
    expect(cursor).toMatchObject({ kind: "position", rel: "c.ts" });

    const again = createGatedPort(files);
    again.releaseAll();
    await runMemoryScan([memoryScope(0, "/repo/", again)], ["hit"], {
      cursor,
    });
    expect(again.opened).toEqual(["d.ts", "e.ts"]);
  });

  it("names the file a deadline stopped inside and skips it next time", async () => {
    const clock = { value: 0 };
    const files = {
      "big.log": { content: "x".repeat(128), chunkBytes: 32, holdAfter: 0 },
      "z.log": { content: "miss\n" },
    } satisfies Record<string, GatedFile>;
    const port = createGatedPort(files, (rel, index) => {
      if (rel === "big.log" && index === 1) clock.value = 40;
    });
    const scope = memoryScope(0, "/var/log/", port);
    const run = runMemoryScan([scope], ["hit"], {
      budget: { deadlineMs: 10 },
      now: () => clock.value,
    });
    await settle();
    // Only the gated read still holds a file and the scan is pending, so the
    // call waits on it: the release runs the head's deadline check.
    expect(port.inFlight()).toBe(1);
    port.release("big.log");
    const first = await run;
    expect(first.complete).toBe(false);
    expect(first.progressed).toBe(false);
    expect(first.unfinished).toBe("/var/log/big.log");
    expect(first.warnings).toEqual([{ kind: "deadline", count: 1 }]);
    expect(decode(first.cursor)).toMatchObject({
      kind: "position",
      scopeIndex: 0,
      rel: "big.log",
    });

    const again = createGatedPort(files);
    const second = await runMemoryScan(
      [memoryScope(0, "/var/log/", again)],
      ["hit"],
      { cursor: decode(first.cursor) },
    );
    expect(again.opened).toEqual(["z.log"]);
    expect(second.complete).toBe(true);
  });

  it("skips an unfinished single-file scope to the next ordinal", async () => {
    const clock = { value: 0 };
    const single = createGatedPort(
      { "": { content: "x".repeat(128), chunkBytes: 32, holdAfter: 0 } },
      (_rel, index) => {
        if (index === 1) clock.value = 40;
      },
    );
    const directory = createGatedPort({ "a.ts": { content: "hit\n" } });
    const scopes = [
      memoryScope(0, "/var/log/big.log", single, { singleFile: true }),
      memoryScope(1, "/srv/app/", directory),
    ];
    const run = runMemoryScan(scopes, ["hit"], {
      budget: { deadlineMs: 10 },
      now: () => clock.value,
    });
    await settle();
    single.release("");
    const first = await run;
    expect(first.unfinished).toBe("/var/log/big.log");
    expect(first.results).toEqual([]);
    expect(first.complete).toBe(false);
    expect(decode(first.cursor)).toMatchObject({
      kind: "position",
      scopeIndex: 1,
      rel: "",
    });

    const second = await runMemoryScan(scopes, ["hit"], {
      cursor: decode(first.cursor),
    });
    expect(second.results.map((passage) => passage.locator)).toEqual([
      "/srv/app/a.ts:1-1",
    ]);
    expect(second.complete).toBe(true);
    // The skipped scope is never opened again.
    expect(single.opened).toEqual([""]);
  });

  it("ends an unfinished last single-file scope on the next call", async () => {
    const clock = { value: 0 };
    const single = createGatedPort(
      { "": { content: "x".repeat(128), chunkBytes: 32, holdAfter: 0 } },
      (_rel, index) => {
        if (index === 1) clock.value = 40;
      },
    );
    const scopes = [
      memoryScope(0, "/var/log/big.log", single, { singleFile: true }),
    ];
    const run = runMemoryScan(scopes, ["hit"], {
      budget: { deadlineMs: 10 },
      now: () => clock.value,
    });
    await settle();
    single.release("");
    const first = await run;
    expect(first.unfinished).toBe("/var/log/big.log");
    expect(first.complete).toBe(false);

    const second = await runMemoryScan(scopes, ["hit"], {
      cursor: decode(first.cursor),
    });
    expect(second.results).toEqual([]);
    expect(second.complete).toBe(true);
    expect(single.opened).toEqual([""]);
  });

  it("counts no progress from a cursor on the parent directory", async () => {
    const clock = { value: 0 };
    const port = createGatedPort(
      {
        "logs/big.log": {
          content: "x".repeat(128),
          chunkBytes: 32,
          holdAfter: 0,
        },
        "logs/z.log": { content: "miss\n" },
      },
      (rel, index) => {
        if (rel === "logs/big.log" && index === 1) clock.value = 40;
      },
    );
    const run = runMemoryScan([memoryScope(0, "/repo/", port)], ["hit"], {
      cursor: {
        kind: "position",
        scopeIndex: 0,
        rel: "logs",
        inputHash: "input-hash",
      },
      budget: { deadlineMs: 10 },
      now: () => clock.value,
    });
    await settle();
    port.release("logs/big.log");
    const result = await run;
    // The walk re-enters `logs` without reaching it, so the stop inside its
    // first file is still a stop before any progress.
    expect(result.unfinished).toBe("/repo/logs/big.log");
    expect(result.progressed).toBe(false);
    expect(decode(result.cursor)).toMatchObject({
      kind: "position",
      rel: "logs/big.log",
    });
  });

  it("resumes at the file when the call progressed before the stop", async () => {
    const clock = { value: 0 };
    const files = {
      "a.ts": { content: "miss\n" },
      "b.ts": { content: "miss\n", chunkBytes: 2, holdAfter: 0 },
    } satisfies Record<string, GatedFile>;
    const port = createGatedPort(files, (rel, index) => {
      if (rel === "b.ts" && index === 1) clock.value = 40;
    });
    const run = runMemoryScan([memoryScope(0, "/repo/", port)], ["hit"], {
      budget: { deadlineMs: 10 },
      now: () => clock.value,
    });
    await settle();
    // The finished first file is progress, so the release stops inside the
    // second one without naming it.
    expect(port.inFlight()).toBe(1);
    port.release("b.ts");
    const first = await run;
    expect(first.unfinished).toBeUndefined();
    expect(first.progressed).toBe(true);
    expect(first.complete).toBe(false);
    expect(decode(first.cursor)).toMatchObject({
      kind: "position",
      rel: "a.ts",
    });

    const again = createGatedPort(files);
    again.releaseAll();
    await runMemoryScan([memoryScope(0, "/repo/", again)], ["hit"], {
      cursor: decode(first.cursor),
    });
    expect(again.opened).toEqual(["b.ts"]);
  });

  it("counts the progress of an earlier segment", async () => {
    const clock = { value: 0 };
    const files = {
      "big.log": { content: "x".repeat(128), chunkBytes: 32, holdAfter: 0 },
    } satisfies Record<string, GatedFile>;
    const port = createGatedPort(files, (rel, index) => {
      if (rel === "big.log" && index === 1) clock.value = 40;
    });
    const scope = memoryScope(0, "/var/log/", port);
    const run = runMemoryScan([scope], ["hit"], {
      progressed: true,
      budget: { deadlineMs: 10 },
      now: () => clock.value,
    });
    await settle();
    port.release("big.log");
    const result = await run;
    expect(result.unfinished).toBeUndefined();
    expect(result.progressed).toBe(true);
    // Nothing was reached, so the cursor restarts the scope: the next call
    // opens the file again with a full budget.
    expect(decode(result.cursor)).toMatchObject({
      kind: "position",
      scopeIndex: 0,
      rel: "",
    });
  });

  it("counts an emitted passage as progress", async () => {
    const clock = { value: 0 };
    const port = createGatedPort(
      {
        "a.log": { content: "hit\nhit\n" },
        "b.log": { content: "x".repeat(128), chunkBytes: 32, holdAfter: 0 },
      },
      (rel, index) => {
        if (rel === "b.log" && index === 1) clock.value = 40;
      },
    );
    const run = runMemoryScan([memoryScope(0, "/repo/", port)], ["hit"], {
      cursor: {
        kind: "passage",
        scopeIndex: 0,
        rel: "a.log",
        startLine: 1,
        endLine: 1,
        inputHash: "input-hash",
      },
      budget: { deadlineMs: 10 },
      now: () => clock.value,
    });
    await settle();
    port.release("b.log");
    const result = await run;
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/a.log:2-2",
    ]);
    expect(result.unfinished).toBeUndefined();
    expect(result.progressed).toBe(true);
    expect(result.warnings).toEqual([{ kind: "deadline", count: 1 }]);
  });
});
