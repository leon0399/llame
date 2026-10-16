/**
 * Generates the live-update protocol module (zod validators plus inferred
 * types) from the AsyncAPI document that defines it.
 *
 *   node scripts/generate-live-protocol.mjs <asyncapi.yaml> <output.ts>
 *   node scripts/generate-live-protocol.mjs --validate <asyncapi.yaml>
 *
 * `apps/api/asyncapi.yaml` is the protocol's source of truth. Its message
 * payloads are OpenAPI 3.0 schemas that reference the HTTP API's record
 * schemas in `openapi.json`, so a record sent over the socket has the same
 * shape the HTTP API returns. The document is validated with the official
 * AsyncAPI parser before anything is generated.
 *
 * Every referenced schema becomes its own named zod schema, emitted before
 * its first use; `oneOf` with a `discriminator` becomes a discriminated union.
 * Schema constructs the generator cannot translate faithfully (`allOf`,
 * `anyOf`, `not`, an undiscriminated `oneOf`, unknown keywords) fail
 * generation instead of degrading to `z.any()`.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { OpenAPISchemaParser } from "@asyncapi/openapi-schema-parser";
import { Parser, fromFile } from "@asyncapi/parser";
import { jsonSchemaToZod } from "json-schema-to-zod";
import prettier from "prettier";
import { parse as parseYaml } from "yaml";

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  "type",
  "enum",
  "format",
  "minimum",
  "maxLength",
  "nullable",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "oneOf",
  "discriminator",
  "$ref",
]);

const SCHEMA_POINTER_PREFIX = "/components/schemas/";
const ERROR_SEVERITY = 0;

/** Validates an AsyncAPI document with the official parser; throws on any error. */
export async function validateAsyncApi(file) {
  const parser = new Parser({ schemaParsers: [OpenAPISchemaParser()] });
  const { document, diagnostics } = await fromFile(
    parser,
    path.resolve(file),
  ).parse();
  const errors = diagnostics.filter((d) => d.severity === ERROR_SEVERITY);
  if (!document || errors.length > 0) {
    const detail = errors
      .map((d) => `  ${d.path.join(".")}: ${d.message}`)
      .join("\n");
    throw new Error(`${file} is not a valid AsyncAPI document:\n${detail}`);
  }
}

function lowerFirst(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** Splits a component schema reference into its document file and name. */
export function parseRef(ref, currentFile) {
  const [filePart, pointer] = ref.split("#");
  if (!pointer?.startsWith(SCHEMA_POINTER_PREFIX)) {
    throw new Error(`Only component schema references are supported: ${ref}`);
  }
  const file = filePart
    ? path.resolve(path.dirname(currentFile), filePart)
    : currentFile;
  return { file, name: pointer.slice(SCHEMA_POINTER_PREFIX.length) };
}

function assertSupported(node) {
  for (const key of Object.keys(node)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) {
      throw new Error(`Unsupported schema keyword: ${key}`);
    }
  }
}

/**
 * Renders each named schema reachable from the messages once, dependencies
 * first, so every const is declared before it is used.
 */
class SchemaEmitter {
  constructor(readDocument) {
    this.readDocument = readDocument;
    this.emitted = new Map(); // name -> file
    this.lines = [];
  }

  /** The component schema behind a reference, unwrapped from a multi-format object. */
  lookup({ file, name }) {
    const schema = this.readDocument(file).components?.schemas?.[name];
    if (!schema) throw new Error(`Unresolved reference: ${file}#/${name}`);
    return schema.schemaFormat ? schema.schema : schema;
  }

  /** Emits the named schema and its dependencies; returns its const name. */
  emit(reference) {
    const constName = `${lowerFirst(reference.name)}Schema`;
    const previous = this.emitted.get(reference.name);
    if (previous !== undefined) {
      if (previous !== reference.file) {
        throw new Error(`Schema name ${reference.name} is defined twice`);
      }
      return constName;
    }
    this.emitted.set(reference.name, reference.file);
    const schema = this.lookup(reference);
    if (schema.$ref) {
      throw new Error(`Alias schema not supported: ${reference.name}`);
    }
    const zod = jsonSchemaToZod(schema, {
      module: "none",
      parserOverride: (node) => this.override(node, reference.file),
    });
    if (schema.description) this.lines.push(`/** ${schema.description} */`);
    this.lines.push(
      `export const ${constName} = ${zod};`,
      `export type ${reference.name} = z.infer<typeof ${constName}>;`,
      "",
    );
    return constName;
  }

  override(node, file) {
    assertSupported(node);
    if (node.$ref) return this.emit(parseRef(node.$ref, file));
    if (!node.oneOf) return undefined;
    const property = node.discriminator?.propertyName;
    if (!property || !node.oneOf.every((member) => member.$ref)) {
      throw new Error("oneOf needs a discriminator and $ref members");
    }
    const members = node.oneOf.map((member) =>
      this.emit(parseRef(member.$ref, file)),
    );
    return `z.discriminatedUnion(${JSON.stringify(property)}, [${members.join(", ")}])`;
  }
}

/** The single `send` operation's channel address and message payloads. */
function sendOperation(document, file) {
  const operations = Object.values(document.operations ?? {}).filter(
    (operation) => operation.action === "send",
  );
  if (operations.length !== 1) {
    throw new Error(
      `Expected exactly one send operation, found ${operations.length}`,
    );
  }
  const [operation] = operations;
  const resolveLocal = (ref) =>
    ref
      .slice(2)
      .split("/")
      .reduce((node, segment) => node?.[segment], document);
  const channel = resolveLocal(operation.channel.$ref);
  const messages = operation.messages.map((reference) => {
    const pointer = resolveLocal(reference.$ref);
    const message = pointer?.$ref ? resolveLocal(pointer.$ref) : pointer;
    if (!message?.payload?.$ref) {
      throw new Error(`Message ${message?.name} needs a component payload`);
    }
    return {
      name: message.name,
      payload: parseRef(message.payload.$ref, file),
    };
  });
  return { address: channel.address, messages };
}

/** Reads and caches the AsyncAPI document and the documents it references. */
function documentReader() {
  const documents = new Map();
  return (target) => {
    if (!documents.has(target)) {
      const text = readFileSync(target, "utf8");
      documents.set(
        target,
        target.endsWith(".json") ? JSON.parse(text) : parseYaml(text),
      );
    }
    return documents.get(target);
  };
}

/**
 * Renders the generated TypeScript module, formatted with the Prettier
 * configuration that applies to `outputPath`.
 */
export async function renderLiveProtocol(
  file,
  sourceLabel,
  outputPath,
  readDocument = documentReader(),
) {
  const source = path.resolve(file);
  const { address, messages } = sendOperation(readDocument(source), source);
  const emitter = new SchemaEmitter(readDocument);
  const members = messages.map((message) => {
    const type = emitter.lookup(message.payload).properties?.type?.enum;
    if (type?.length !== 1 || type[0] !== message.name) {
      throw new Error(
        `${message.payload.name} must declare type enum [${message.name}]`,
      );
    }
    return emitter.emit(message.payload);
  });

  const module = [
    `// Generated by scripts/generate-live-protocol.mjs from ${sourceLabel}.`,
    "// Do not edit: change the AsyncAPI document and regenerate.",
    'import { z } from "zod";',
    "",
    `export const LIVE_CHANNEL_ADDRESS = ${JSON.stringify(address)};`,
    "",
    ...emitter.lines,
    "/** Every message the server sends on the channel. */",
    `export const liveMessageSchema = z.discriminatedUnion("type", [${members.join(", ")}]);`,
    "export type LiveMessage = z.infer<typeof liveMessageSchema>;",
    "",
  ].join("\n");
  const options = outputPath ? await prettier.resolveConfig(outputPath) : null;
  return prettier.format(module, { ...options, parser: "typescript" });
}

async function main(args) {
  if (args[0] === "--validate") {
    for (const file of args.slice(1)) await validateAsyncApi(file);
    return;
  }
  const [input, output] = args;
  if (!input || !output) {
    throw new Error(
      "usage: generate-live-protocol.mjs <asyncapi.yaml> <output.ts>",
    );
  }
  await validateAsyncApi(input);
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const label = path
    .relative(repositoryRoot, path.resolve(input))
    .replaceAll(path.sep, "/");
  const source = await renderLiveProtocol(input, label, path.resolve(output));
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, source);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
