import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CANCEL_NOTIFICATION,
  isSerializableRecord,
  isStringValue,
  MCP_MESSAGE_NOTIFICATION,
  MCP_PROTECTED_NOTIFICATION,
  MCP_SET_PROTOCOL_VERSION_NOTIFICATION,
  MCP_STDERR_NOTIFICATION,
  PATH_NOT_REGISTERED_MESSAGE,
  type JsonValue,
} from "@workspace/machine-protocol";
import { createRootFixture, type RootFixture } from "./testing/fixtures";
import { isString } from "@workspace/runtime-safety";
import {
  envelope,
  isGone,
  startDaemon,
  waitFor,
  type TestChannel,
  type TestDaemon,
} from "./testing/harness";
import {
  startMcpHttpFixture,
  type McpHttpFixture,
} from "./testing/mcp-http-fixture";

const STDIO_SERVER = join(__dirname, "testing", "mcp-stdio-server-fixture.mjs");
const FIXTURE_VARIABLE = "MACHINE_MCP_FIXTURE";
const HUB_ONLY_VARIABLE = "MACHINE_HUB_ONLY_TOKEN";
const SECRET_VARIABLE = "MACHINE_MCP_REPO_TOKEN";
const SECRET = "s3cret-repo-token";

let fixture: RootFixture;
let daemon: TestDaemon;
let httpFixtures: Array<McpHttpFixture>;
let localServers: Array<Server>;
let touchedVariables: Array<string>;

beforeEach(async () => {
  fixture = await createRootFixture();
  daemon = startDaemon({ roots: [fixture.root] });
  httpFixtures = [];
  localServers = [];
  touchedVariables = [];
  const hello = await daemon.hello();
  expect(hello.ok).toBe(true);
});

afterEach(async () => {
  daemon.input.end();
  await daemon.session.done;
  for (const server of localServers) server.closeAllConnections();
  for (const httpFixture of httpFixtures) await httpFixture.stop();
  for (const name of touchedVariables) delete process.env[name];
  await fixture.cleanup();
});

/** A variable the daemon reads at `mcp.*` time, undone by the teardown. */
function setVariable(name: string, value: string): void {
  process.env[name] = value;
  touchedVariables.push(name);
}

async function writeWorkspaceConfig(
  servers: Record<string, JsonValue>,
): Promise<void> {
  await writeFile(
    join(fixture.root, ".mcp.json"),
    JSON.stringify({ mcpServers: servers }),
    "utf8",
  );
}

/** A `.mcp.json` entry for the stdio fixture, with its own configuration. */
function stdioServer(
  fixtureConfig: JsonValue,
  extraEnv: Record<string, string> = {},
): JsonValue {
  return {
    type: "stdio",
    command: process.execPath,
    args: [STDIO_SERVER],
    env: { ...extraEnv, [FIXTURE_VARIABLE]: JSON.stringify(fixtureConfig) },
  };
}

function initializeMessage(id: number): JsonValue {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "machine-daemon-test", version: "0.0.0" },
    },
  };
}

/** One message the hub relays into the server on an open channel. */
function relay(opened: TestChannel, message: JsonValue): void {
  opened.channel.notify(MCP_MESSAGE_NOTIFICATION, { message });
}

/** The relayed message answering request `id`, once it has arrived. */
async function awaitRelayed(
  opened: TestChannel,
  id: number,
): Promise<JsonValue> {
  const find = (): JsonValue | undefined => {
    for (const notification of opened.notifications) {
      if (notification.method !== MCP_MESSAGE_NOTIFICATION) continue;
      const params = notification.params;
      if (!isSerializableRecord(params)) continue;
      const message = params["message"];
      if (isSerializableRecord(message) && message["id"] === id) return message;
    }
    return undefined;
  };
  await waitFor(() => find() !== undefined);
  const message = find();
  if (message === undefined) throw new Error("the relay answered nothing");
  return message;
}

function notificationsOf(
  opened: TestChannel,
  method: string,
): ReadonlyArray<JsonValue> {
  return opened.notifications
    .filter((notification) => notification.method === method)
    .map((notification) => notification.params ?? null);
}

/** Every diagnostic line the daemon reported on this channel. */
function diagnosticsOf(opened: TestChannel): ReadonlyArray<string> {
  const texts: Array<string> = [];
  for (const params of notificationsOf(opened, MCP_STDERR_NOTIFICATION)) {
    if (!isSerializableRecord(params)) continue;
    const text = params["text"];
    if (isStringValue(text)) texts.push(text);
  }
  return texts;
}

/** The message of a refusal, for assertions on an untrusted error value. */
function errorMessageOf(error: unknown): string {
  if (!isSerializableRecord(error)) return "";
  const message = error["message"];
  return isString(message) ? message : "";
}

type OpenedServer = {
  readonly opened: TestChannel;
  readonly result: JsonValue;
};

async function openServer(
  server: string,
  root: string = fixture.root,
): Promise<OpenedServer> {
  const opened = daemon.open();
  const result = await opened.channel.request("mcp.open", {
    envelope: envelope(),
    root,
    server,
  });
  return { opened, result };
}

function listenLocal(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  localServers.push(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || isString(address))
        reject(new Error("the test server has no TCP address"));
      else resolve(`http://127.0.0.1:${String(address.port)}/mcp`);
    });
  });
}

describe("mcp.servers", () => {
  it("reports every declared server with its transport and state", async () => {
    await writeWorkspaceConfig({
      greeter: stdioServer({ tools: [] }),
      "web-server": { type: "http", url: "http://127.0.0.1:9/mcp" },
    });

    const result = await daemon.call("mcp.servers", {
      envelope: envelope(),
      root: fixture.root,
    });

    expect(result).toMatchObject({
      servers: [
        { name: "greeter", transport: "stdio", state: "available" },
        { name: "web-server", transport: "http", state: "available" },
      ],
    });
  });

  it("reports a server only the hub can resolve as unavailable here", async () => {
    await writeWorkspaceConfig({
      hubOnly: stdioServer(
        { tools: [] },
        { REPO_TOKEN: `{env:${HUB_ONLY_VARIABLE}}` },
      ),
    });

    const result = await daemon.call("mcp.servers", {
      envelope: envelope(),
      root: fixture.root,
    });

    expect(result).toMatchObject({
      servers: [{ name: "hubOnly", state: "unavailable" }],
    });
    expect(JSON.stringify(result)).toContain(HUB_ONLY_VARIABLE);
    expect(JSON.stringify(result)).not.toContain("transport");
  });

  it("refuses a root outside the registered roots", async () => {
    const outcome = await daemon.attempt("mcp.servers", {
      envelope: envelope(),
      root: fixture.outside,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatchObject({
      code: "path_not_registered",
      message: PATH_NOT_REGISTERED_MESSAGE,
    });
  });

  it("refuses a root that is not a directory", async () => {
    const outcome = await daemon.attempt("mcp.servers", {
      envelope: envelope(),
      root: fixture.notes,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatchObject({ code: "invalid_params" });
  });

  it("reports a declaration it cannot parse as unavailable", async () => {
    await writeFile(join(fixture.root, ".mcp.json"), "{ not json", "utf8");

    const result = await daemon.call("mcp.servers", {
      envelope: envelope(),
      root: fixture.root,
    });

    expect(result).toMatchObject({
      servers: [{ name: ".mcp.json", state: "unavailable" }],
    });
    expect(JSON.stringify(result)).toContain("is malformed");
  });
});

describe("mcp.open with a stdio server", () => {
  it("relays initialize and tools/list and answers with what it started", async () => {
    await writeWorkspaceConfig({
      greeter: stdioServer({
        tools: [
          {
            name: "greet",
            description: "Say hello.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      }),
    });

    const { opened, result } = await openServer("greeter");
    expect(result).toMatchObject({ protectedValues: [] });

    opened.channel.notify(MCP_SET_PROTOCOL_VERSION_NOTIFICATION, {});
    relay(opened, initializeMessage(1));
    expect(await awaitRelayed(opened, 1)).toMatchObject({
      result: {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "machine-stdio-fixture" },
      },
    });

    relay(opened, { jsonrpc: "2.0", method: "notifications/initialized" });
    relay(opened, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(await awaitRelayed(opened, 2)).toMatchObject({
      result: { tools: [{ name: "greet" }] },
    });
  });

  it("starts the definition as it now stands, not as it was discovered", async () => {
    const dumpPath = join(fixture.base, "env.json");
    setVariable(SECRET_VARIABLE, "value-before-the-edit");
    setVariable(`${SECRET_VARIABLE}_NEW`, "value-after-the-edit");
    await writeWorkspaceConfig({
      greeter: stdioServer(
        { tools: [], envDumpPath: dumpPath },
        { REPO_TOKEN: `{env:${SECRET_VARIABLE}}` },
      ),
    });
    const discovered = await daemon.call("mcp.servers", {
      envelope: envelope(),
      root: fixture.root,
    });
    expect(discovered).toMatchObject({
      servers: [{ name: "greeter", state: "available" }],
    });

    await writeWorkspaceConfig({
      greeter: stdioServer(
        { tools: [], envDumpPath: dumpPath },
        { REPO_TOKEN: `{env:${SECRET_VARIABLE}_NEW}` },
      ),
    });
    const { opened, result } = await openServer("greeter");

    expect(result).toMatchObject({
      protectedValues: ["value-after-the-edit"],
    });
    await waitFor(() => existsSync(dumpPath), 5000);
    const dumped: unknown = JSON.parse(await readFile(dumpPath, "utf8"));
    expect(dumped).toMatchObject({ REPO_TOKEN: "value-after-the-edit" });
    opened.channel.notify(CANCEL_NOTIFICATION, {});
  });

  it("keeps the values it resolved out of diagnostics", async () => {
    setVariable(SECRET_VARIABLE, SECRET);
    await writeWorkspaceConfig({
      talkative: stdioServer(
        { tools: [], stderr: [`token is ${SECRET}\n`] },
        { REPO_TOKEN: `{env:${SECRET_VARIABLE}}` },
      ),
    });

    const { opened, result } = await openServer("talkative");
    expect(result).toMatchObject({ protectedValues: [SECRET] });

    relay(opened, initializeMessage(1));
    await awaitRelayed(opened, 1);
    relay(opened, { jsonrpc: "2.0", method: "notifications/initialized" });

    await waitFor(() => diagnosticsOf(opened).length > 0, 5000);
    const diagnostics = diagnosticsOf(opened).join("");
    expect(diagnostics).toContain("[REDACTED]");
    expect(diagnostics).not.toContain(SECRET);
  });

  it("refuses a server name this Workspace does not declare", async () => {
    await writeWorkspaceConfig({ greeter: stdioServer({ tools: [] }) });

    const outcome = await openServer("absent").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(outcome).toMatchObject({ code: "invalid_params" });
    expect(errorMessageOf(outcome)).toContain("no server named absent");
  });

  it("refuses a server only the hub can resolve", async () => {
    await writeWorkspaceConfig({
      hubOnly: stdioServer(
        { tools: [] },
        { REPO_TOKEN: `{env:${HUB_ONLY_VARIABLE}}` },
      ),
    });

    const outcome = await openServer("hubOnly").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(outcome).toMatchObject({ code: "invalid_params" });
    expect(errorMessageOf(outcome)).toContain(HUB_ONLY_VARIABLE);
  });

  it("refuses a root outside the registered roots", async () => {
    await writeWorkspaceConfig({ greeter: stdioServer({ tools: [] }) });

    await expect(openServer("greeter", fixture.outside)).rejects.toMatchObject({
      code: "path_not_registered",
      message: PATH_NOT_REGISTERED_MESSAGE,
    });
  });

  it("reports a server that cannot start as an internal failure", async () => {
    await writeWorkspaceConfig({
      broken: {
        type: "stdio",
        command: join(fixture.base, "absent-binary"),
      },
    });

    const outcome = await openServer("broken").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(outcome).toMatchObject({ code: "internal" });
    expect(errorMessageOf(outcome)).toContain(
      "mcp.open: the server could not be started",
    );
  });

  it("refuses a hub message that is not a JSON-RPC message", async () => {
    await writeWorkspaceConfig({ greeter: stdioServer({ tools: [] }) });
    const { opened } = await openServer("greeter");

    relay(opened, { nope: true });

    await waitFor(() =>
      diagnosticsOf(opened).some((text) =>
        text.includes("not a JSON-RPC message"),
      ),
    );
  });

  it("ignores notifications it does not serve and one without a message", async () => {
    await writeWorkspaceConfig({ greeter: stdioServer({ tools: [] }) });
    const { opened } = await openServer("greeter");

    opened.channel.notify("mcp.unrelated", {});
    opened.channel.notify(MCP_SET_PROTOCOL_VERSION_NOTIFICATION);
    relay(opened, initializeMessage(1));
    expect(await awaitRelayed(opened, 1)).toMatchObject({
      result: { serverInfo: { name: "machine-stdio-fixture" } },
    });

    opened.channel.notify(MCP_MESSAGE_NOTIFICATION);
    await waitFor(() =>
      diagnosticsOf(opened).some((text) =>
        text.includes("not a JSON-RPC message"),
      ),
    );
  });

  it("kills the stdio server when the hub cancels the stream", async () => {
    const pidFile = join(fixture.base, "cancelled.pid");
    await writeWorkspaceConfig({
      greeter: stdioServer({ tools: [], pidFile }),
    });
    const { opened } = await openServer("greeter");
    await waitFor(() => existsSync(pidFile), 5000);
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(isGone(pid)).toBe(false);

    opened.channel.notify(CANCEL_NOTIFICATION, {});

    await waitFor(() => isGone(pid), 5000);
  });

  it("kills the stdio server when the session ends", async () => {
    const pidFile = join(fixture.base, "ended.pid");
    await writeWorkspaceConfig({
      greeter: stdioServer({ tools: [], pidFile }),
    });
    await openServer("greeter");
    await waitFor(() => existsSync(pidFile), 5000);
    const pid = Number(await readFile(pidFile, "utf8"));

    daemon.input.end();
    await daemon.session.done;

    expect(isGone(pid)).toBe(true);
  });

  it("reports the exit of a server the hub is still talking to", async () => {
    await writeWorkspaceConfig({
      exiting: stdioServer({ tools: [], exitAfterInit: true }),
    });
    const { opened } = await openServer("exiting");

    relay(opened, initializeMessage(1));
    await awaitRelayed(opened, 1);
    relay(opened, { jsonrpc: "2.0", method: "notifications/initialized" });

    await waitFor(() =>
      diagnosticsOf(opened).some((text) => text.includes("the server exited")),
    );
  });
});

describe("mcp.open with an HTTP server", () => {
  it("relays tools/list and protects the session id it learns", async () => {
    const httpFixture = await startMcpHttpFixture({
      sessionId: "machine-fixture-session",
    });
    httpFixtures.push(httpFixture);
    await writeWorkspaceConfig({
      "web-server": { type: "http", url: httpFixture.url },
    });

    const { opened, result } = await openServer("web-server");
    expect(result).toMatchObject({ protectedValues: [] });

    relay(opened, initializeMessage(1));
    await awaitRelayed(opened, 1);
    relay(opened, { jsonrpc: "2.0", method: "notifications/initialized" });
    relay(opened, { jsonrpc: "2.0", id: 2, method: "tools/list" });

    expect(await awaitRelayed(opened, 2)).toMatchObject({
      result: { tools: [{ name: "ping" }] },
    });
    const protectedNotifications = notificationsOf(
      opened,
      MCP_PROTECTED_NOTIFICATION,
    );
    await waitFor(() => protectedNotifications.length > 0);
    expect(protectedNotifications).toMatchObject([
      { values: ["machine-fixture-session"] },
    ]);
    expect(
      httpFixture.requests.some(
        (request) => request.sessionId === "machine-fixture-session",
      ),
    ).toBe(true);
  });

  it("applies the protocol version the hub sets", async () => {
    const httpFixture = await startMcpHttpFixture();
    httpFixtures.push(httpFixture);
    await writeWorkspaceConfig({
      "web-server": { type: "http", url: httpFixture.url },
    });
    const { opened } = await openServer("web-server");

    relay(opened, initializeMessage(1));
    await awaitRelayed(opened, 1);
    opened.channel.notify(MCP_SET_PROTOCOL_VERSION_NOTIFICATION, {
      version: 5,
    });
    opened.channel.notify(MCP_SET_PROTOCOL_VERSION_NOTIFICATION, {
      version: "2025-06-18",
    });
    relay(opened, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    await awaitRelayed(opened, 2);

    expect(
      httpFixture.requests.filter(
        (request) => request.protocolVersion === "2025-06-18",
      ),
    ).not.toHaveLength(0);
  });

  it("refuses a redirect instead of following it", async () => {
    let targetHits = 0;
    await listenLocal((_request, response) => {
      targetHits += 1;
      response.end("hit");
    });
    const redirecting = await listenLocal((_request, response) => {
      response.writeHead(302, { location: "http://127.0.0.1:1/elsewhere" });
      response.end();
    });
    await writeWorkspaceConfig({
      redirected: { type: "http", url: redirecting },
    });

    const { opened } = await openServer("redirected");
    relay(opened, initializeMessage(1));

    await waitFor(() =>
      diagnosticsOf(opened).some((text) =>
        text.includes("unexpected redirect"),
      ),
    );
    expect(targetHits).toBe(0);
  });
});
