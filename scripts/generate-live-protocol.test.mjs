import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";

import {
  parseRef,
  renderLiveProtocol,
  validateAsyncApi,
} from "./generate-live-protocol.mjs";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "apps/api/asyncapi.yaml");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

/** A document reader over the real files, with selected documents replaced. */
function readerWith(overrides = {}) {
  return (file) => {
    if (overrides[file]) return overrides[file];
    const text = readFileSync(file, "utf8");
    return file.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
  };
}

const asyncapi = () => parseYaml(read("apps/api/asyncapi.yaml"));
const render = (document) =>
  renderLiveProtocol(
    source,
    "test",
    undefined,
    readerWith({ [source]: document }),
  );

test("both committed protocol modules match the AsyncAPI document", async () => {
  for (const generated of [
    "apps/api/src/live/generated/live-protocol.ts",
    "apps/web/lib/api/live-generated/live-protocol.ts",
  ]) {
    const expected = await renderLiveProtocol(
      source,
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

test("the AsyncAPI document passes the official parser", async () => {
  await validateAsyncApi(source);
});

test("generates OpenAPI records as named schemas and pins as a discriminated union", async () => {
  const module = await render(asyncapi());
  assert.match(module, /export const chatListItemResponseSchema = z/);
  assert.match(module, /chat: chatListItemResponseSchema/);
  assert.match(
    module,
    /z\.discriminatedUnion\("itemType", \[\s*chatPinnedItemResponseSchema,\s*projectPinnedItemResponseSchema,?\s*\]\)/,
  );
  assert.doesNotMatch(module, /z\.any\(\)\.superRefine/);
});

test("rejects a schema keyword the generator does not support", async () => {
  const broken = asyncapi();
  broken.components.schemas.ResyncMessage.schema.properties.type.pattern =
    "^x$";
  await assert.rejects(render(broken), /Unsupported schema keyword: pattern/);
});

test("rejects a oneOf without a discriminator", async () => {
  const broken = asyncapi();
  const items =
    broken.components.schemas.PinsReplacedMessage.schema.properties.items;
  delete items.items.discriminator;
  await assert.rejects(render(broken), /oneOf needs a discriminator/);
});

test("rejects a message whose payload type enum does not match its name", async () => {
  const broken = asyncapi();
  broken.components.schemas.ResyncMessage.schema.properties.type.enum = [
    "other",
  ];
  await assert.rejects(
    render(broken),
    /ResyncMessage must declare type enum \[resync\]/,
  );
});

test("rejects a document without exactly one send operation", async () => {
  const broken = asyncapi();
  broken.operations.sendLiveUpdate.action = "receive";
  await assert.rejects(
    render(broken),
    /Expected exactly one send operation, found 0/,
  );
});

test("rejects a reference that does not resolve", async () => {
  const broken = asyncapi();
  broken.components.schemas.ChatUpsertedMessage.schema.properties.chat.$ref =
    "./openapi.json#/components/schemas/Nope";
  await assert.rejects(render(broken), /Unresolved reference: .*Nope/);
});

test("resolves references relative to the referring document", () => {
  assert.deepEqual(
    parseRef("./openapi.json#/components/schemas/ChatListItemResponse", source),
    {
      file: path.join(root, "apps/api/openapi.json"),
      name: "ChatListItemResponse",
    },
  );
  assert.deepEqual(parseRef("#/components/schemas/RunPhase", source), {
    file: source,
    name: "RunPhase",
  });
  assert.throws(
    () => parseRef("#/components/messages/resync", source),
    /Only component schema references/,
  );
});
