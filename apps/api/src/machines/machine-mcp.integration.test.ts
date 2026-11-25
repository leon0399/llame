import { createMCPClient, type MCPClient, type JSONRPCMessage } from '@ai-sdk/mcp';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MACHINE_BINARY } from '../testing/local-daemon';
import { createLocalChildTransportFactory } from './local-child-transport';
import type { MachineConnector } from './machine-connector.service';
import { MachineTransport } from './machine-mcp-transport';
import { MachineSession } from './machine-session';

const FIXTURE = join(__dirname, '../mcp/mcp-stdio-test-fixture.mjs');
const BUDGET_MS = 60_000;

describe('MCP OpenSession on the local daemon', () => {
  it('connects the SDK through the bridge, initializes, and lists tools', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'llame-mcp-config-'));
    const stateDir = mkdtempSync(join(tmpdir(), 'llame-mcp-state-'));
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'llame-mcp-root-')));

    const fixtureConfig = JSON.stringify({
      tools: [{ name: 'fixture_tool', description: 'A bridge fixture tool.', inputSchema: { type: 'object', properties: {} } }],
    });

    writeFileSync(join(root, '.mcp.json'), JSON.stringify({
      mcpServers: { fixture: { command: process.execPath, args: [FIXTURE], env: { MCP_FIXTURE: fixtureConfig } } },
    }));
    const daemonEnv = { ...process.env, LLAME_MACHINE_CONFIG_DIR: configDir, LLAME_MACHINE_STATE_DIR: stateDir };
    execFileSync(MACHINE_BINARY, ['roots', 'add', root], { env: daemonEnv, stdio: 'pipe' });
    const factory = createLocalChildTransportFactory({ command: MACHINE_BINARY, env: daemonEnv });

    const session = new MachineSession({
      name: 'mcp-test',
      transport: factory.open({ name: 'mcp-test' }),
      hubVersion: '0.0.0-mcp-integration-test',
      handshakeTimeoutMs: BUDGET_MS,
    });

    const connector = {
      machineSession: async () => session,
      releaseMachineSession: () => undefined,
    } as unknown as MachineConnector;

    const transport = new MachineTransport({
      connector,
      machine: 'mcp-test',
      root,
      server: 'fixture',
      envelope: { budgetMs: BUDGET_MS },
    });

    const sent: Array<JSONRPCMessage> = [];
    const received: Array<JSONRPCMessage> = [];
    let onmessage: MachineTransport['onmessage'];
    Object.defineProperty(transport, 'onmessage', {
      configurable: true,
      get: () => onmessage,
      set: (handler: typeof onmessage) => {
        onmessage = handler === undefined ? undefined : (message) => {
          received.push(message);
          handler(message);
        };
      },
    });
    const send = transport.send.bind(transport);
    transport.send = (message, options) => {
      sent.push(message);

      return send(message, options);
    };

    let client: MCPClient | undefined;

    try {
      await session.ready();
      client = await createMCPClient({ transport, maxRetries: 0 });
      const result = await client.listTools();

      expect(result.tools).toMatchObject([{ name: 'fixture_tool' }]);
      expect(received.map((message) => 'id' in message ? message.id : undefined)).toEqual([0, 1]);
      expect(received.map((message) => 'result' in message ? message.result : undefined)).toMatchObject([
        { serverInfo: { name: 'stdio-fixture' } },
        { tools: [{ name: 'fixture_tool' }] },
      ]);
      expect(sent.map((message) => 'id' in message ? message.id : undefined)).toEqual([0, undefined, 1]);
      expect(sent.map((message) => 'method' in message ? message.method : undefined)).toEqual([
        'initialize',
        'notifications/initialized',
        'tools/list',
      ]);
    } finally {
      await client?.close();
      session.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(configDir, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
