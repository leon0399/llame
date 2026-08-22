import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { SqliteRunRouteRegistry } from "./run-route-registry.js";

describe("durable Run-to-peer routing", () => {
  const directories: string[] = [];
  const registries: SqliteRunRouteRegistry[] = [];

  afterEach(async () => {
    for (const registry of registries.splice(0)) registry.close();
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function open(): Promise<{
    readonly path: string;
    readonly registry: SqliteRunRouteRegistry;
  }> {
    const directory = await mkdtemp(join(tmpdir(), "llame-run-routes-"));
    directories.push(directory);
    const path = join(directory, "routes.sqlite");
    const registry = new SqliteRunRouteRegistry({ databasePath: path });
    registries.push(registry);
    return { path, registry };
  }

  test("pins a Run idempotently and requires an epoch to move it", async () => {
    const { registry } = await open();

    expect(registry.bind("run-1", "workstation")).toEqual({
      runId: "run-1",
      peerId: "workstation",
      routeEpoch: 1,
    });
    expect(registry.bind("run-1", "workstation")).toEqual({
      runId: "run-1",
      peerId: "workstation",
      routeEpoch: 1,
    });
    expect(() => registry.bind("run-1", "laptop")).toThrowError(
      "Run is already routed to another peer",
    );

    expect(registry.rebind("run-1", "laptop", 1)).toEqual({
      runId: "run-1",
      peerId: "laptop",
      routeEpoch: 2,
    });
    expect(() => registry.rebind("run-1", "workstation", 1)).toThrowError(
      "Run route epoch conflict",
    );
  });

  test("survives restart without storing peer credentials", async () => {
    const { path, registry } = await open();
    registry.bind("run-1", "workstation");
    registry.close();
    registries.splice(registries.indexOf(registry), 1);

    const reopened = new SqliteRunRouteRegistry({ databasePath: path });
    registries.push(reopened);
    expect(reopened.resolve("run-1")).toEqual({
      runId: "run-1",
      peerId: "workstation",
      routeEpoch: 1,
    });
    expect(await stat(path)).toMatchObject({ mode: expect.any(Number) });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  test("rejects invalid route identities", async () => {
    const { registry } = await open();
    expect(() => registry.bind("", "workstation")).toThrowError(
      "invalid Run id",
    );
    expect(() => registry.bind("run-1", "../peer")).toThrowError(
      "invalid peer id",
    );
  });
});
