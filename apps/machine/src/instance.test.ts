import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInstanceFile,
  instanceFileFor,
  readOrCreateInstanceId,
} from "./instance";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "llame-instance-"));
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

describe("instance id", () => {
  it("creates a UUID v4 on first use and reuses it afterwards", () => {
    const created = readOrCreateInstanceId(configDir);

    expect(created).toMatch(UUID_V4);
    expect(statSync(instanceFileFor(configDir)).mode & 0o777).toBe(0o600);
    expect(readFileSync(instanceFileFor(configDir), "utf8")).toBe(
      `${JSON.stringify({ instanceId: created })}\n`,
    );
    expect(readOrCreateInstanceId(configDir)).toBe(created);
  });

  it("keeps the first id when a second writer races it", () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";

    expect(createInstanceFile(configDir, first)).toBe(first);
    expect(createInstanceFile(configDir, second)).toBe(first);
    expect(readOrCreateInstanceId(configDir)).toBe(first);
  });

  it("leaves no temp files behind", () => {
    readOrCreateInstanceId(configDir);
    createInstanceFile(configDir, "33333333-3333-4333-8333-333333333333");

    expect(readdirSync(configDir)).toEqual(["instance.json"]);
  });

  it("refuses a corrupt file instead of overwriting it", () => {
    writeFileSync(instanceFileFor(configDir), "not json");

    expect(() => readOrCreateInstanceId(configDir)).toThrow(
      `The instance file ${instanceFileFor(configDir)} is unreadable or corrupt; restore it or delete it to create a new instance id.`,
    );
    expect(readFileSync(instanceFileFor(configDir), "utf8")).toBe("not json");
  });

  it("refuses a syntactically valid but malformed id", () => {
    writeFileSync(instanceFileFor(configDir), '{"instanceId":"nope"}\n');

    expect(() => readOrCreateInstanceId(configDir)).toThrow(
      /is unreadable or corrupt/,
    );
  });
});
