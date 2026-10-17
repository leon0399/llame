import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";

import {
  parseRef,
  renderChannelModule,
  renderLiveProtocol,
  validateAsyncApi,
} from "./generate-asyncapi-module.mjs";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "apps/api/asyncapi.websocket.yaml");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

/** A document reader over the real files, with selected documents replaced. */
function readerWith(overrides = {}) {
  return (file) => {
    if (overrides[file]) return overrides[file];
    const text = readFileSync(file, "utf8");
    return file.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
  };
}

const queueSource = path.join(root, "apps/api/asyncapi.queues.yaml");
const queueGenerated = "apps/api/src/queue/generated/queue-protocol.ts";

const asyncapi = () => parseYaml(read("apps/api/asyncapi.websocket.yaml"));
const queues = () => parseYaml(read("apps/api/asyncapi.queues.yaml"));
const renderChannels = (document) =>
  renderChannelModule(
    queueSource,
    "test",
    undefined,
    readerWith({ [queueSource]: document }),
  );
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
      "apps/api/asyncapi.websocket.yaml",
      path.join(root, generated),
    );
    assert.equal(
      read(generated),
      expected,
      `${generated} is stale: run pnpm generate:api-client`,
    );
  }
});

test("the AsyncAPI documents pass the official parser", async () => {
  await validateAsyncApi(source);
  await validateAsyncApi(queueSource);
});

test("the committed queue module matches the queue AsyncAPI document", async () => {
  const expected = await renderChannelModule(
    queueSource,
    "apps/api/asyncapi.queues.yaml",
    path.join(root, queueGenerated),
  );
  assert.equal(
    read(queueGenerated),
    expected,
    `${queueGenerated} is stale: run pnpm --filter api generate:queue-protocol`,
  );
});

test("generates one constant per channel with its address, options and payload", async () => {
  const module = await renderChannels(queues());
  assert.match(
    module,
    /export const searchEmbedChannel = \{\s*address: "search-embed",\s*options: \{ policy: "stately", retryLimit: 5, retryBackoff: true \},\s*payload: searchChatJobSchema,\s*\} as const;/,
  );
  assert.match(
    module,
    /export const runsChannel = \{\s*address: "runs",\s*payload: runJobSchema,\s*\} as const;/,
  );
  assert.match(module, /userMessage: runUserMessageSchema/);
});

test("rejects a channel that does not carry exactly one message", async () => {
  const broken = queues();
  broken.channels.runs.messages.other = {
    $ref: "#/components/messages/cronTick",
  };
  await assert.rejects(
    renderChannels(broken),
    /Channel runs must carry exactly one message, found 2/,
  );
});

test("rejects a queue option pg-boss does not apply per queue", async () => {
  for (const option of ["retryLimitz", "heartbeatSeconds"]) {
    const broken = queues();
    broken.channels.searchEmbed["x-llame-queue"][option] = 5;
    await assert.rejects(
      renderChannels(broken),
      new RegExp(`Channel searchEmbed declares unknown queue option ${option}`),
    );
  }
});

test("rejects a channel message without a component payload", async () => {
  const broken = queues();
  broken.components.messages.runJob.payload = { type: "object" };
  await assert.rejects(
    renderChannels(broken),
    /Channel runs needs a component payload/,
  );
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
