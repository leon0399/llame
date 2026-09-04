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

import {
  InterpolationError,
  interpolateString,
  interpolateStringWithSubstitutions,
} from "./interpolation";
import { InstanceConfigError } from "./instance-config-error";

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
      expect(errorMessage(error)).toBe(
        "required environment variable IC_TEST_VAR is not set",
      );
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

  it("reports non-empty substitutions and omits empty resolutions", () => {
    const result = interpolateStringWithSubstitutions(
      "before {env:IC_TEST_VAR} middle {env:IC_TEST_SECRET} after",
      { IC_TEST_VAR: "resolved", IC_TEST_SECRET: "" },
    );

    expect(result).toEqual({
      value: "before resolved middle  after",
      substituted: ["resolved"],
    });
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
      expect(errorMessage(error)).toContain(
        `required file ${missing} could not be read:`,
      );
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

  it("reports file substitutions and omits an empty trimmed file", () => {
    const valueFile = tempSecretFile("file-secret", "value.txt");
    const emptyFile = tempSecretFile("  \n", "empty.txt");
    const result = interpolateStringWithSubstitutions(
      `{path:${valueFile}}|{path:${emptyFile}}`,
    );

    expect(result).toEqual({
      value: "file-secret|",
      substituted: ["file-secret"],
    });
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

  it("selects array members and continues through nested objects", () => {
    const file = tempSecretFile(
      JSON.stringify({ items: ["first", { name: "second" }] }),
      "auth.json",
    );

    expect(interpolateString(`{path:${file}|json:/items/0}`)).toBe("first");
    expect(interpolateString(`{path:${file}|json:/items/1/name}`)).toBe(
      "second",
    );
  });

  it("does not treat array or scalar properties as object members", () => {
    const file = tempSecretFile(
      JSON.stringify({ items: ["first"], scalar: "secret" }),
      "pseudo-properties.json",
    );

    for (const pointer of ["/items/length", "/scalar/length"]) {
      expect(() => interpolateString(`{path:${file}|json:${pointer}}`)).toThrow(
        `JSON pointer did not select a value in ${file}`,
      );
    }
  });

  it("rejects malformed pointers and invalid array traversal", () => {
    const file = tempSecretFile(
      JSON.stringify({
        "/": "slash-secret",
        key: "key-secret",
        items: ["first"],
        scalar: "secret",
      }),
      "auth.json",
    );
    const invalidPointers = [
      "items/0",
      "xkey",
      "Stryker was here!",
      "/~2",
      "/items/~2",
      "/items/01",
      "/items/1",
      "/items/-",
      "/scalar/child",
    ];

    for (const pointer of invalidPointers) {
      expect(() => interpolateString(`{path:${file}|json:${pointer}}`)).toThrow(
        InterpolationError,
      );
    }
  });

  it("enforces JSON array index grammar instead of coercing tokens", () => {
    const file = tempSecretFile(
      JSON.stringify({
        items: Array.from({ length: 13 }, (_, index) => `item-${index}`),
      }),
      "array-indexes.json",
    );

    expect(interpolateString(`{path:${file}|json:/items/10}`)).toBe("item-10");
    expect(interpolateString(`{path:${file}|json:/items/12}`)).toBe("item-12");

    for (const pointer of ["/items/ 1", "/items/1 "]) {
      expect(() => interpolateString(`{path:${file}|json:${pointer}}`)).toThrow(
        `JSON pointer did not select a value in ${file}`,
      );
    }
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
      expect(errorMessage(error)).toBe(
        `JSON pointer must select a string in ${file}`,
      );
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
      expect(errorMessage(error)).toBe(
        `required file ${badJson} is not valid JSON`,
      );
      expect(errorMessage(error)).not.toContain("not-json");
    }

    try {
      interpolateString(`{path:${missingPointer}|json:/missing}`);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InterpolationError);
      expect(errorMessage(error)).toBe(
        `JSON pointer did not select a value in ${missingPointer}`,
      );
      expect(errorMessage(error)).not.toContain("s3cr3t");
    }
  });

  it("accepts primitive JSON roots while rejecting non-string selections", () => {
    const cases = [
      ["number", JSON.stringify(42)],
      ["boolean", JSON.stringify(true)],
      ["null", JSON.stringify(null)],
    ] as const;

    for (const [name, content] of cases) {
      const file = tempSecretFile(content, `${name}.json`);
      expect(() => interpolateString(`{path:${file}|json:}`)).toThrow(
        `JSON pointer must select a string in ${file}`,
      );
    }
  });

  it("resolves a JSON string root through an empty pointer", () => {
    const file = tempSecretFile(JSON.stringify("root-secret"), "root.json");

    expect(interpolateString(`{path:${file}|json:}`)).toBe("root-secret");
  });

  it("accepts every JSON primitive while selecting a nested string", () => {
    const file = tempSecretFile(
      JSON.stringify({
        selected: "nested-secret",
        number: 42,
        boolean: true,
        nothing: null,
      }),
      "primitives.json",
    );

    expect(interpolateString(`{path:${file}|json:/selected}`)).toBe(
      "nested-secret",
    );
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

describe("InstanceConfigError", () => {
  it("sets its error name", () => {
    expect(new InstanceConfigError("invalid config").name).toBe(
      "InstanceConfigError",
    );
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
