import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpHost } from '../dist/mcp-host.js';
import { parseMcpServers } from '../dist/mcp-config.js';
import { commandEnvironment } from '../dist/env.js';
import { runLocal } from '../dist/local-run.js';
import { LocalStore } from '../dist/store.js';
import { Output } from '../dist/output.js';
import { loadConfig } from '../dist/config.js';
import { directory, config, key, invoke, server, completion, tool, chatId } from './helpers.mjs';

const signal = () => new AbortController().signal;
const configuration = (extra = {}) => ({ id: 'notes', transport: 'http', url: 'https://notes.example/mcp', headers: {}, autoApprove: [], callTimeoutSeconds: 10, ...extra });
function fixture(names = ['read', 'write']) {
  const calls = []; let closed = 0; let disconnect;
  const tools = names.map(remoteName => ({ id: `mcp__notes__${remoteName}`, remoteName,
    description: 'Untrusted server claims read-only; that is not permission.', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
    validate: args => typeof args?.query === 'string',
    execute: async (args, id, signal) => { calls.push({ remoteName, args, id, signal }); return { result: { status: 'success', content: 'note' }, disconnected: false }; },
  }));
  const connector = async (_server, _secrets, _env, _signal, onDisconnect) => {
    disconnect = onDisconnect;
    return { discover: async () => ({ tools, refused: [] }), close: async () => { closed++; } };
  };
  return { connector, tools, calls, closed: () => closed, disconnect: () => disconnect() };
}

test('MCP host requires per-call approval; annotations cannot authorize; invalid args never execute', async () => {
  const f = fixture(); const audit = []; const host = await McpHost.connect([configuration()], [], {}, signal(), f.connector);
  assert.equal(host.catalog.length, 2);
  await assert.rejects(host.execute('mcp__notes__read', { query: 'hello' }, 'call1', signal(), async () => false, (type, data) => audit.push({ type, data })), { code: 'approval_denied' });
  assert.equal(f.calls.length, 0);
  assert.equal(audit.at(-1).data.approved, false);
  await assert.rejects(host.execute('mcp__notes__read', {}, 'bad', signal(), async () => true, () => {}), { code: 'invalid_tool_arguments' });
  assert.equal(f.calls.length, 0);
  const approved = await host.execute('mcp__notes__read', { query: 'hello' }, 'call2', signal(), async () => true, () => {});
  assert.equal(approved.status, 'success'); assert.equal(f.calls[0].id, 'call2');
  await host.close(); await host.close(); assert.equal(f.closed(), 1);
});

test('MCP exact allowlist and explicit automatic approval are independent of server metadata', async () => {
  const f = fixture(); const host = await McpHost.connect([configuration({ allowTools: ['read'], autoApprove: ['read'] })], [], {}, signal(), f.connector);
  assert.deepEqual(host.catalog.map(t => t.function.name), ['mcp__notes__read']);
  await assert.rejects(host.execute('mcp__notes__write', { query: 'x' }, 'call', signal(), async () => true, () => {}), { code: 'tool_unavailable' });
  let asks = 0;
  await host.execute('mcp__notes__read', { query: 'x' }, 'call', signal(), async () => { asks++; return false; }, () => {});
  assert.equal(asks, 0); assert.equal(f.calls.length, 1); await host.close();
});

test('MCP cannot receive configured secrets, survive disconnection, or reconnect automatically', async () => {
  const f = fixture(); const host = await McpHost.connect([configuration({ autoApprove: ['read'] })], [key], {}, signal(), f.connector);
  await assert.rejects(host.execute('mcp__notes__read', { query: key }, 'secret', signal(), async () => true, () => {}), { code: 'protected_argument' });
  f.disconnect();
  await assert.rejects(host.execute('mcp__notes__read', { query: 'normal' }, 'call', signal(), async () => true, () => {}), { code: 'mcp_disconnected' });
  assert.equal(f.calls.length, 0); await host.close();
});

test('MCP connector cleanup occurs on discovery error, collisions, and global catalog overflow', async () => {
  for (const mode of ['discovery', 'collision', 'limit']) {
    const f = fixture(mode === 'limit' ? Array.from({ length: 129 }, (_, n) => `t${n}`) : ['read']);
    const connector = mode === 'discovery' ? async () => ({ discover: async () => { throw new Error('server leaked a secret'); }, close: async () => f.closedCount = 1 }) : f.connector;
    const servers = mode === 'collision' ? [configuration(), configuration({ id: 'other' })] : [configuration()];
    await assert.rejects(McpHost.connect(servers, [], {}, signal(), connector), error => {
      assert.ok(!error.message.includes('server leaked')); return true;
    });
    assert.equal(mode === 'discovery' ? f.closedCount : f.closed(), mode === 'collision' ? 2 : 1);
  }
});

test('empty MCP configuration never initializes connector dependencies', async () => {
  let started = false;
  const host = await McpHost.connect([], [], {}, signal(), async () => { started = true; throw new Error('must not run'); });
  assert.equal(started, false); assert.deepEqual(host.catalog, []); await host.close();
});

test('MCP config resolves only enabled credentials, keeps auth/protocol headers separate, and rejects escalated policies', () => {
  const secrets = [];
  const servers = parseMcpServers({
    notes: { enabled: true, transport: 'http', url: 'https://notes.example/mcp/', headers: { Authorization: 'Bearer {env:NOTES_KEY}' }, allowTools: ['read'], autoApprove: ['read'] },
    draft: { enabled: false, transport: 'stdio', env: { TOKEN: '{env:UNSET}' } },
  }, { NOTES_KEY: key, LLAME_TOKEN: 'never-inherit' }, '/config/cli.json', secrets);
  assert.equal(servers.length, 1); assert.equal(servers[0].url, 'https://notes.example/mcp/');
  assert.equal(servers[0].headers.Authorization, `Bearer ${key}`); assert.ok(secrets.includes(key));
  const config = { enabled: true, transport: 'http', url: 'https://notes.example/mcp' };
  for (const headers of [{ 'Mcp-Session-Id': 'x' }, { Host: 'evil.example' }, { Authorization: 'a', authorization: 'b' }, { Authorization: 'a\r\nb' }]) {
    assert.throws(() => parseMcpServers({ notes: { ...config, headers } }, {}, '/config/cli.json', []));
  }
  assert.throws(() => parseMcpServers({ notes: { ...config, allowTools: ['read'], autoApprove: ['write'] } }, {}, '/config/cli.json', []), { code: 'mcp_policy' });
  assert.throws(() => parseMcpServers({ notes: { ...config, enabled: 'true' } }, {}, '/config/cli.json', []), { code: 'mcp_enabled' });
  assert.throws(() => parseMcpServers({ notes: { ...config, url: 'http://external.example' } }, {}, '/config/cli.json', []), { code: 'insecure_url' });
  assert.throws(() => parseMcpServers({ notes: { ...config, url: 'https://x.example/mcp?token=secret' } }, {}, '/config/cli.json', []), { code: 'invalid_url' });
});

test('stdio MCP config has explicit cwd/env; command environment excludes auth/provider secrets', () => {
  const secrets = [];
  const [server] = parseMcpServers({ notes: { transport: 'stdio', enabled: true, command: 'node', args: ['/trusted/server.mjs'], env: { NOTES_TOKEN: '{env:NOTES_KEY}' } } }, { NOTES_KEY: key }, '/config/cli.json', secrets);
  assert.equal(server.cwd, '/config'); assert.deepEqual(server.env, { NOTES_TOKEN: key });
  const env = commandEnvironment({ PATH: '/bin', HOME: '/private', LLAME_TOKEN: 'secret', OPENAI_API_KEY: key });
  assert.equal(env.HOME, undefined); assert.equal(env.LLAME_TOKEN, undefined); assert.equal(env.OPENAI_API_KEY, undefined);
  assert.throws(() => parseMcpServers({ notes: { enabled: true, transport: 'stdio', command: 'node', cwd: './repo' } }, {}, '/config/cli.json', []), { code: 'mcp_cwd' });
});

test('MCP list and enable/disable persist without resolving model credentials or starting a process', async () => {
  const dir = directory(); const path = join(dir, 'cli.json');
  const doc = { version: 1, models: [{ apiKey: '{env:MISSING_MODEL_KEY}' }], mcp: { notes: { transport: 'stdio', enabled: false, command: 'DO_NOT_START_THIS_PROGRAM', env: { TOKEN: '{env:UNSET}' } } } };
  writeFileSync(path, JSON.stringify(doc), { mode: 0o600 });
  const listed = await invoke(['--local', '--config', path, '--json', 'mcp', 'list'], { dir });
  assert.equal(listed.code, 0, listed.stderr); assert.equal(JSON.parse(listed.stdout).servers[0].enabled, false);
  assert.ok(!listed.stdout.includes('UNSET')); assert.ok(!listed.stdout.includes('DO_NOT_START'));
  const enabled = await invoke(['--local', '--config', path, 'mcp', 'enable', 'notes'], { dir }); assert.equal(enabled.code, 0, enabled.stderr);
  assert.equal(JSON.parse(readFileSync(path)).mcp.notes.enabled, true);
  assert.equal(JSON.parse(readFileSync(path)).mcp.notes.env.TOKEN, '{env:UNSET}');
  assert.equal((await invoke(['--local', '--config', path, 'mcp', 'disable', 'notes'], { dir })).code, 0);
  assert.equal(JSON.parse(readFileSync(path)).mcp.notes.enabled, false);
  const denied = await invoke(['--remote', 'https://hub.example', '--config', path, 'mcp', 'list'], { dir });
  assert.equal(denied.code, 1); assert.match(denied.stderr, /mode_conflict/);
});

test('local model loop executes admitted MCP without native Workspace and records approval, result, and exact declarations', async t => {
  const dir = directory(); const f = fixture(['read']); let turns = 0;
  const original = f.tools[0].execute;
  f.tools[0].execute = async (...args) => { const result = await original(...args); return { ...result, result: { status: 'success', content: key } }; };
  const provider = await server(t, (request, response) => {
    assert.deepEqual(request.body.tools?.map(tool => tool.function.name), ['mcp__notes__read']);
    assert.ok(!JSON.stringify(request.body).includes(key));
    if (turns++ === 0) return tool(response, 'mcp__notes__read', { query: 'remember' });
    assert.equal(JSON.parse(request.body.messages.at(-1).content).status, 'success');
    completion(response, 'Read the note.');
  });
  const path = config(dir, provider.base, { mcp: { notes: { transport: 'http', enabled: true, url: 'https://notes.example/mcp', autoApprove: ['read'] } } });
  const options = loadConfig(path, { TEST_PROVIDER_KEY: key }); const store = new LocalStore(join(dir, 'store'));
  t.after(() => store.close());
  const output = new Output(true); output.event = () => {}; output.notice = () => {}; output.text = () => {};
  const id = await runLocal({ store, config: options, model: options.models[0], chatId, prompt: 'Read my note', cwd: dir, configPath: path, native: false,
    approve: async () => { throw new Error('explicit configuration already approved this tool'); }, processEnv: {}, signal: signal(), output, mcpConnector: f.connector });
  assert.equal(f.calls.length, 1); assert.equal(f.closed(), 1);
  const snapshot = store.run(id).snapshot;
  assert.equal(snapshot.workspace, null); assert.equal(snapshot.tools[0].name, 'mcp__notes__read');
  assert.equal(snapshot.mcp[0].id, 'notes'); assert.ok(!JSON.stringify(snapshot).includes(key));
  const events = store.events(id); assert.ok(events.some(event => event.eventType === 'tool.approval_decided' && event.payload.approved));
  assert.ok(events.some(event => event.eventType === 'tool.completed' && event.payload.result.status === 'success'));
  assert.equal(store.run(id).status, 'completed');
  assert.ok(!JSON.stringify(store.history(chatId)).includes(key));
});

test('MCP IDs cannot collide with namespace separators and credentials cannot be interpolated into argv', () => {
  const base = { enabled: true, transport: 'stdio', command: 'node' };
  assert.throws(() => parseMcpServers({ bad__id: base }, {}, '/config/cli.json', []), { code: 'mcp_id' });
  assert.throws(() => parseMcpServers({ notes: { ...base, args: ['--token={env:SECRET}'] } }, { SECRET: key }, '/config/cli.json', []), { code: 'mcp_config' });
  const secrets = [];
  parseMcpServers({ notes: { ...base, env: { API_KEY: key } } }, {}, '/config/cli.json', secrets);
  assert.ok(secrets.includes(key));
});


test('an ambiguous MCP call failure marks the source disconnected without retrying or leaking server error text', async () => {
  const f = fixture(['read']); let attempts = 0;
  f.tools[0].execute = async () => { attempts++; throw new Error(`untrusted server error ${key}`); };
  const host = await McpHost.connect([configuration({ autoApprove: ['read'] })], [key], {}, signal(), f.connector);
  await assert.rejects(host.execute('mcp__notes__read', { query: 'x' }, 'first', signal(), async () => true, () => {}), error => {
    assert.equal(error.code, 'mcp_call_failed'); assert.ok(!error.message.includes(key)); assert.match(error.message, /side effect may have occurred/); return true;
  });
  await assert.rejects(host.execute('mcp__notes__read', { query: 'x' }, 'again', signal(), async () => true, () => {}), { code: 'mcp_disconnected' });
  assert.equal(attempts, 1); await host.close(); assert.equal(f.closed(), 1);
});
