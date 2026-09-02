/**
 * Interpolation unit tests (openspec/changes/instance-config, task 4.2).
 * Covers the spec.md scenarios under "Environment-variable interpolation",
 * "File-path (secret) interpolation", and "Token placement, typing, and
 * escaping" that are expressible against interpolateString directly (whole-
 * value numeric coercion lives in config-loader.ts and is tested there,
 * since it needs the config-path context this module deliberately doesn't
 * have).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { InterpolationError, interpolateString } from "./interpolation";

/** Narrows a `catch`-clause `unknown` to the InterpolationError it's expected to be, without a cast. */
function interpolationErrorSource(err: unknown): InterpolationError["source"] {
  if (!(err instanceof InterpolationError)) {
    throw new Error(
      `expected an InterpolationError instance, got ${String(err)}`,
    );
  }
  return err.source;
}

/** Narrows a `catch`-clause `unknown` to its message without a cast. */
function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    throw new Error(`expected an Error instance, got ${String(err)}`);
  }
  return err.message;
}

const ENV_KEYS = [
  "IC_TEST_VAR",
  "IC_TEST_SECRET",
  "IC_TEST_RECURSIVE_TARGET",
] as const;

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe("interpolateString — {env:...}", () => {
  it("resolves a set environment variable", () => {
    process.env.IC_TEST_VAR = "gpt-5.4-mini";
    expect(interpolateString("{env:IC_TEST_VAR}")).toBe("gpt-5.4-mini");
  });

  it("throws InterpolationError naming the variable when required and missing", () => {
    expect(() => interpolateString("{env:IC_TEST_VAR}")).toThrow(
      InterpolationError,
    );
    try {
      interpolateString("{env:IC_TEST_VAR}");
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InterpolationError);
      expect(interpolationErrorSource(error)).toEqual({
        kind: "env",
        name: "IC_TEST_VAR",
      });
    }
  });

  it("falls back to the :- default when unset", () => {
    expect(interpolateString("{env:IC_TEST_VAR:-fallback}")).toBe("fallback");
  });

  it("prefers the set value over the :- default", () => {
    process.env.IC_TEST_VAR = "set-value";
    expect(interpolateString("{env:IC_TEST_VAR:-fallback}")).toBe("set-value");
  });

  it("falls back to the :- default when set but EMPTY (bash :- semantics)", () => {
    process.env.IC_TEST_VAR = "";
    expect(interpolateString("{env:IC_TEST_VAR:-fallback}")).toBe("fallback");
  });

  it("returns the empty string for a plain token on a set-but-empty variable (no :- given)", () => {
    process.env.IC_TEST_VAR = "";
    expect(interpolateString("{env:IC_TEST_VAR}")).toBe("");
  });

  it("resolves from an explicitly passed env, never process.env", () => {
    process.env.IC_TEST_VAR = "from-process-env";
    expect(
      interpolateString("{env:IC_TEST_VAR}", { IC_TEST_VAR: "from-custom" }),
    ).toBe("from-custom");
    expect(() => interpolateString("{env:IC_TEST_VAR}", {})).toThrow(
      InterpolationError,
    );
  });

  it("embeds a token within a larger string", () => {
    process.env.IC_TEST_VAR = "ollama.local";
    expect(interpolateString("https://{env:IC_TEST_VAR}/v1")).toBe(
      "https://ollama.local/v1",
    );
  });

  it("is non-recursive — a resolved value is never re-scanned for tokens", () => {
    process.env.IC_TEST_RECURSIVE_TARGET = "inner";
    process.env.IC_TEST_VAR = "{env:IC_TEST_RECURSIVE_TARGET}";
    expect(interpolateString("{env:IC_TEST_VAR}")).toBe(
      "{env:IC_TEST_RECURSIVE_TARGET}",
    );
  });
});

describe("interpolateString — {path:...}", () => {
  function tempSecretFile(content: string, name = "secret.txt"): string {
    const dir = mkdtempSync(path.join(tmpdir(), "llame-instance-config-"));
    const file = path.join(dir, name);
    writeFileSync(file, content);
    return file;
  }

  it("resolves to the trimmed contents of an existing file", () => {
    const file = tempSecretFile("  sk-super-secret-value  \n");
    expect(interpolateString(`{path:${file}}`)).toBe("sk-super-secret-value");
  });

  it("throws InterpolationError naming the location when the file is missing", () => {
    const missing = path.join(tmpdir(), "llame-instance-config-missing-file");
    try {
      interpolateString(`{path:${missing}}`);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InterpolationError);
      expect(interpolationErrorSource(error)).toEqual({
        kind: "path",
        location: missing,
      });
    }
  });

  it("selects a string via an RFC 6901 JSON pointer", () => {
    const file = tempSecretFile(
      JSON.stringify({
        opencode: { key: "json-secret" },
        "a/b": { "~key": "escaped" },
      }),
      "auth.json",
    );
    expect(interpolateString(`{path:${file}|json:/opencode/key}`)).toBe(
      "json-secret",
    );
    expect(interpolateString(`{path:${file}|json:/a~1b/~0key}`)).toBe(
      "escaped",
    );
  });

  it("selects an own JSON member named __proto__", () => {
    // Object-literal / JSON.stringify would not emit this key; write raw JSON
    // so the fixture matches what a real secret file can contain.
    const file = tempSecretFile(
      '{"__proto__":"proto-secret","other":"x"}',
      "auth.json",
    );
    expect(interpolateString(`{path:${file}|json:/__proto__}`)).toBe(
      "proto-secret",
    );
  });

  it("does not trim a JSON-selected string", () => {
    const file = tempSecretFile(
      JSON.stringify({ key: "  spaced  " }),
      "auth.json",
    );
    expect(interpolateString(`{path:${file}|json:/key}`)).toBe("  spaced  ");
  });

  it("rejects a non-string JSON selection without echoing the secret", () => {
    const file = tempSecretFile(
      JSON.stringify({ opencode: { key: "s3cr3t" } }),
      "auth.json",
    );
    try {
      interpolateString(`{path:${file}|json:/opencode}`);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InterpolationError);
      expect(interpolationErrorSource(error)).toEqual({
        kind: "path",
        location: file,
      });
      expect(errorMessage(error)).not.toContain("s3cr3t");
    }
  });

  it("rejects invalid JSON or a missing pointer without echoing contents", () => {
    const badJson = tempSecretFile("{not-json", "bad.json");
    const missingPointer = tempSecretFile(
      JSON.stringify({ key: "s3cr3t" }),
      "auth.json",
    );

    try {
      interpolateString(`{path:${badJson}|json:/key}`);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InterpolationError);
      expect(errorMessage(error)).not.toContain("not-json");
    }

    try {
      interpolateString(`{path:${missingPointer}|json:/missing}`);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InterpolationError);
      expect(errorMessage(error)).not.toContain("s3cr3t");
    }
  });
});

describe("interpolateString — escaping", () => {
  it("{{ resolves to a literal { with no interpolation attempted on it", () => {
    expect(interpolateString("literal {{env:IC_TEST_VAR}")).toBe(
      "literal {env:IC_TEST_VAR}",
    );
  });

  it("a lone { that starts no recognized token passes through unchanged", () => {
    expect(interpolateString("just a { brace")).toBe("just a { brace");
  });
});

describe("interpolateString — redaction", () => {
  it("a missing-variable error never contains any resolved value", () => {
    process.env.IC_TEST_SECRET = "sk-should-never-appear";
    try {
      // A sibling token resolves a secret; this one is missing and required.
      interpolateString("{env:IC_TEST_SECRET}{env:IC_TEST_VAR}");
      expect.unreachable("expected throw");
    } catch (error) {
      expect(errorMessage(error)).not.toContain("sk-should-never-appear");
    }
  });
});
