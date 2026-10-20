import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EXIT_INCOMPATIBLE_VERSION,
  EXIT_OK,
  EXIT_PROTOCOL_ERROR,
  EXIT_USAGE,
  runCli,
  runMain,
  type CliEnvironment,
} from "./cli-commands";
import { DAEMON_VERSION } from "./version";
import { createRootFixture, type RootFixture } from "./testing/fixtures";
import type { MachineSession, SessionEndReason } from "./serve";

type Cli = {
  readonly env: CliEnvironment;
  readonly out: () => string;
  readonly err: () => string;
};

function cli(reason?: SessionEndReason): Cli {
  const out: Array<string> = [];
  const err: Array<string> = [];
  const collect: CliEnvironment = {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  };
  const session = (): MachineSession => ({
    done: Promise.resolve(reason ?? "closed"),
    stop: () => {},
  });
  return {
    env: reason === undefined ? collect : { ...collect, serve: session },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

let fixture: RootFixture;

beforeEach(async () => {
  fixture = await createRootFixture();
  process.env["LLAME_MACHINE_CONFIG_DIR"] = join(fixture.base, "config");
});

afterEach(async () => {
  delete process.env["LLAME_MACHINE_CONFIG_DIR"];
  process.exitCode = undefined;
  await fixture.cleanup();
});

const rootsFile = () => join(fixture.base, "config", "roots.json");

describe("roots command", () => {
  it("adds, lists, and removes a root through the daemon's own file", async () => {
    const add = cli();
    await expect(runCli(["roots", "add", fixture.root], add.env)).resolves.toBe(
      EXIT_OK,
    );
    expect(add.out()).toBe(`${fixture.root}\n`);
    await expect(readFile(rootsFile(), "utf8")).resolves.toContain(
      fixture.root,
    );
    const listed = cli();
    await expect(runCli(["roots", "list"], listed.env)).resolves.toBe(EXIT_OK);
    expect(listed.out()).toBe(`${fixture.root}\n`);
    const removed = cli();
    await expect(
      runCli(["roots", "remove", fixture.root], removed.env),
    ).resolves.toBe(EXIT_OK);
    expect(removed.out()).toBe(`${fixture.root}\n`);
    const empty = cli();
    await expect(runCli(["roots", "list"], empty.env)).resolves.toBe(EXIT_OK);
    expect(empty.out()).toBe("");
  });

  it("reports a failed roots command on stderr", async () => {
    const missing = cli();
    await expect(
      runCli(["roots", "add", join(fixture.base, "absent")], missing.env),
    ).resolves.toBe(EXIT_USAGE);
    expect(missing.err()).toContain("Directory does not exist");
  });

  it("prints usage for an unknown subcommand", async () => {
    const unknown = cli();
    await expect(runCli(["roots", "show"], unknown.env)).resolves.toBe(
      EXIT_USAGE,
    );
    expect(unknown.err()).toContain("Usage:");
  });
});

describe("serve command", () => {
  it("requires the stdio flag", async () => {
    const bare = cli();
    await expect(runCli(["serve"], bare.env)).resolves.toBe(EXIT_USAGE);
    expect(bare.err()).toContain("Usage:");
    await expect(runCli(["serve", "--socket"], cli().env)).resolves.toBe(
      EXIT_USAGE,
    );
  });

  it("maps a session end to the process status the hub reads", async () => {
    for (const reason of ["input_ended", "heartbeat_lost", "closed"] as const)
      await expect(runCli(["serve", "--stdio"], cli(reason).env)).resolves.toBe(
        EXIT_OK,
      );
    await expect(
      runCli(["serve", "--stdio"], cli("incompatible_version").env),
    ).resolves.toBe(EXIT_INCOMPATIBLE_VERSION);
    await expect(
      runCli(["serve", "--stdio"], cli("protocol_error").env),
    ).resolves.toBe(EXIT_PROTOCOL_ERROR);
  });
});

describe("top level", () => {
  it("prints the daemon version", async () => {
    const version = cli();
    await expect(runCli(["--version"], version.env)).resolves.toBe(EXIT_OK);
    expect(version.out()).toBe(`${DAEMON_VERSION}\n`);
  });

  it("prints usage for an unknown command", async () => {
    const unknown = cli();
    await expect(runCli(["migrate"], unknown.env)).resolves.toBe(EXIT_USAGE);
    expect(unknown.err()).toContain("llame-machine serve --stdio");
  });

  it("sets the process status when run as the program", async () => {
    await expect(runMain(["roots", "list"])).resolves.toBe(EXIT_OK);
    expect(process.exitCode).toBe(EXIT_OK);
  });

  it("reports a broken roots file without a stack trace", async () => {
    await mkdir(join(fixture.base, "config"), { recursive: true });
    await writeFile(rootsFile(), "not json");
    await expect(runMain(["roots", "list"])).resolves.toBe(EXIT_USAGE);
    expect(process.exitCode).toBe(EXIT_USAGE);
  });
});
