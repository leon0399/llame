import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { SqliteRunControlProxyCache } from "./run-control-proxy-cache.js";

describe("durable Run-control proxy cache", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("preserves owner-only last-known semantic state across restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-proxy-cache-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "proxy-cache.sqlite");
    const cache = new SqliteRunControlProxyCache({ databasePath });
    cache.put(
      "/v1/runs/run-1/control?after=0",
      {
        status: "running",
        authorityEpoch: 2,
        cursor: 4,
        events: [],
      },
      new Date("2026-08-22T13:00:00.000Z"),
    );
    cache.close();

    const reopened = new SqliteRunControlProxyCache({ databasePath });

    expect(reopened.get("/v1/runs/run-1/control?after=0")).toEqual({
      observedAt: "2026-08-22T13:00:00.000Z",
      state: {
        status: "running",
        authorityEpoch: 2,
        cursor: 4,
        events: [],
      },
    });
    expect((await stat(databasePath)).mode & 0o777).toBe(0o600);
    reopened.close();
  });
});
