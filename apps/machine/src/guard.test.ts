import { lstat, rename, symlink, unlink } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PATH_NOT_REGISTERED_MESSAGE } from "@workspace/machine-protocol";
import { createRootGuard, type RootGuard } from "./guard";
import { createRootFixture, type RootFixture } from "./testing/fixtures";

let fixture: RootFixture;
let guard: RootGuard;

beforeEach(async () => {
  fixture = await createRootFixture();
  guard = createRootGuard([fixture.root]);
});

afterEach(async () => {
  await fixture.cleanup();
});

function refusal() {
  return {
    name: "MachineRequestError",
    code: "path_not_registered",
    message: PATH_NOT_REGISTERED_MESSAGE,
  };
}

describe("root enforcement", () => {
  it("refuses an absent and an existing path outside the roots identically", async () => {
    const absent = await guard
      .resolvePath(`${fixture.outside}/missing.txt`)
      .catch((error: unknown) => error);
    const existing = await guard
      .resolvePath(fixture.secret)
      .catch((error: unknown) => error);
    expect(absent).toMatchObject(refusal());
    expect(existing).toEqual(absent);
  });

  it("refuses a path that leaves the roots by lexical traversal", async () => {
    await expect(
      guard.resolvePath(`${fixture.root}/../outside/secret.txt`),
    ).rejects.toMatchObject(refusal());
  });

  it("refuses a relative path as a malformed request", async () => {
    await expect(guard.resolvePath("notes.txt")).rejects.toMatchObject({
      name: "MachineRequestError",
      code: "invalid_params",
    });
  });

  it("resolves a path inside the roots without probing outside them", async () => {
    const guarded = await guard.resolvePath(fixture.notes);
    expect(guarded).toEqual({
      path: fixture.notes,
      canonical: fixture.notes,
      kind: "file",
      size: 19,
      isLink: false,
    });
  });

  it("follows a link that stays inside the roots", async () => {
    const guarded = await guard.resolvePath(fixture.insideLink);
    expect(guarded.canonical).toBe(fixture.notes);
    expect(guarded.isLink).toBe(true);
    expect(guarded.kind).toBe("file");
  });

  it("refuses a link that points outside the roots", async () => {
    await expect(guard.resolvePath(fixture.escapeLink)).rejects.toMatchObject(
      refusal(),
    );
  });

  it("refuses a dangling link that points outside the roots", async () => {
    await expect(guard.resolvePath(fixture.danglingLink)).rejects.toMatchObject(
      refusal(),
    );
  });

  it("refuses a path created under a link that leaves the roots", async () => {
    await expect(
      guard.resolvePath(`${fixture.escapeLink}/new.txt`),
    ).rejects.toMatchObject(refusal());
  });

  it("refuses a target above the roots for a not-yet-existing path", async () => {
    const guarded = await guard.resolvePath(`${fixture.root}/new/deep.txt`);
    expect(guarded.kind).toBe("missing");
    expect(guarded.canonical).toBe(`${fixture.root}/new/deep.txt`);
  });

  it("refuses the same address once a link replaces it", async () => {
    const target = `${fixture.root}/swapped.txt`;
    await symlink(fixture.notes, target);
    expect((await guard.resolvePath(target)).canonical).toBe(fixture.notes);
    await unlink(target);
    await symlink(fixture.secret, target);
    await expect(guard.resolvePath(target)).rejects.toMatchObject(refusal());
  });

  it("refuses a path whose ancestor was replaced by an escaping link", async () => {
    const directory = `${fixture.root}/moved`;
    const inside = `${fixture.root}/moved/file.txt`;
    expect((await guard.resolvePath(inside)).canonical).toBe(inside);
    const moved = await lstat(directory).catch(() => undefined);
    expect(moved).toBeUndefined();
    await symlink(fixture.outside, directory);
    await expect(guard.resolvePath(inside)).rejects.toMatchObject(refusal());
  });

  it("keeps the root itself addressable", async () => {
    const guarded = await guard.resolvePath(fixture.root);
    expect(guarded.kind).toBe("directory");
  });

  it("accepts everything under a root of the filesystem root", async () => {
    const everywhere = createRootGuard(["/"]);
    expect((await everywhere.resolvePath("/etc/hostname")).kind).toBe("file");
  });

  it("refuses the filesystem root to a guard without roots", async () => {
    const nowhere = createRootGuard([]);
    await expect(nowhere.resolvePath("/etc/hostname")).rejects.toMatchObject(
      refusal(),
    );
  });

  it("resolves a path under a renamed ancestor", async () => {
    const renamed = `${fixture.root}/renamed.txt`;
    await rename(fixture.notes, renamed);
    const guarded = await guard.resolvePath(renamed);
    expect(guarded.canonical).toBe(renamed);
    await rename(renamed, fixture.notes);
  });
});
