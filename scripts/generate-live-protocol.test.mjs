import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";

import { inlineSchema, renderLiveProtocol } from "./generate-live-protocol.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const document = () => parseYaml(read("apps/api/asyncapi.yaml"));

test("both committed protocol modules match the AsyncAPI document", async () => {
  for (const generated of [
    "apps/api/src/live/generated/live-protocol.ts",
    "apps/web/lib/api/live-generated/live-protocol.ts",
  ]) {
    const expected = await renderLiveProtocol(
      document(),
      "apps/api/asyncapi.yaml",
      path.join(root, generated),
    );
    assert.equal(
      read(generated),
      expected,
      `${generated} is stale: run pnpm generate:api-client`,
    );
  }
});

test("rejects a schema keyword the generator does not support", () => {
  assert.throws(
    () => inlineSchema({}, { type: "string", pattern: "^x$" }),
    /Unsupported JSON Schema keyword: pattern/,
  );
});

test("rejects an unresolved or external reference", () => {
  assert.throws(
    () => inlineSchema({ components: {} }, { $ref: "#/components/nope" }),
    /Unresolved reference/,
  );
  assert.throws(
    () => inlineSchema({}, { $ref: "other.yaml#/x" }),
    /Only local references/,
  );
});

test("rejects a message whose payload type const does not match its name", async () => {
  const broken = document();
  broken.components.schemas.ResyncMessage.properties.type.const = "other";
  await assert.rejects(
    renderLiveProtocol(broken, "test"),
    /ResyncMessage must be an object whose type const is "resync"/,
  );
});

test("rejects a document without exactly one send operation", async () => {
  const broken = document();
  broken.operations.sendLiveUpdate.action = "receive";
  await assert.rejects(
    renderLiveProtocol(broken, "test"),
    /Expected exactly one send operation, found 0/,
  );
});
