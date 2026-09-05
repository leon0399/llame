/** Actual production MCP client, not an injected connection port. Missing SDK
 * dependencies fail this suite; they never silently skip the wire contract.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { completion, config, directory, events, invoke, json, key, server, token, tool } from '../helpers.mjs';

const mcpKey = 'mcp-test-private-credential-123456789';
const read = { name: 'read', description: 'Read a note.', inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false } };
const write = { name: 'write', description: 'Update a note.', inputSchema: { type: 'object', properties: {} } };
const stdioFixture = fileURLToPath(new URL('../../../../packages/tool-runtime/src/mcp-stdio-test-fixture.mjs', import.meta.url));

async function mcpServer(t, { result = { content: [{ type: 'text', text: 'note text' }] }, onCall, protocolVersion = '2025-11-25' } = {}) {
  return server(t, (req, res) => {
    if (req.method === 'GET') { res.writeHead(405); res.end(); return; }
    if (req.method === 'DELETE') { res.writeHead(204); res.end(); return; }
    const request = req.body;
    if (request?.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    if (request?.method === 'initialize') return json(res, { jsonrpc: '2.0', id: request.id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'cli-wire-fixture', version: '1.0.0' } } });
    if (request?.method === 'tools/list') return json(res, { jsonrpc: '2.0', id: request.id,
      result: request.params?.cursor ? { tools: [write] } : { tools: [read], nextCursor: 'second' } });
    if (request?.method === 'tools/call') {
      onCall?.(req); return json(res, { jsonrpc: '2.0', id: request.id, result });
    }
    res.writeHead(202); res.end();
  });
}
function httpConfig(url, automatic = true) {
  return { notes: { enabled: true, transport: 'http', url, headers: { Authorization: 'Bearer {env:MCP_KEY}' }, allowTools: ['read'], autoApprove: automatic ? ['read'] : [] } };
}

test('production HTTP MCP pages declarations, validates calls, enforces allowlists, and redacts credentials through the complete model loop', async t => {
  const dir = directory(); let step = 0;
  const mcp = await mcpServer(t, { result: { content: [{ type: 'text', text: `private output ${mcpKey}` }] } });
  const provider = await server(t, (req, res) => {
    assert.deepEqual(req.body.tools.map(item => item.function.name), ['search_conversations', 'conversation_read', 'mcp__notes__read']);
    assert.ok(!JSON.stringify(req.body).includes(mcpKey));
    assert.ok(!JSON.stringify(req.body).includes(key));
    if (step++ === 0) return tool(res, 'mcp__notes__read', { id: 'not an integer' }, 'invalid');
    if (step === 2) {
      assert.equal(JSON.parse(req.body.messages.at(-1).content).type, 'invalid_tool_arguments');
      return tool(res, 'mcp__notes__read', { id: 7 }, 'valid');
    }
    assert.equal(JSON.parse(req.body.messages.at(-1).content).status, 'success');
    completion(res, 'Read the note.');
  });
  const path = config(dir, provider.base, { mcp: httpConfig(`${mcp.base}/mcp`) });
  const result = await invoke(['--local', '--config', path, '--json', 'run', 'Read note seven'], { dir, env: { TEST_PROVIDER_KEY: key, MCP_KEY: mcpKey } });
  assert.equal(result.code, 0, result.stderr);
  const calls = mcp.requests.filter(req => req.body?.method === 'tools/call');
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].body.params.arguments, { id: 7 });
  assert.ok(mcp.requests.some(req => req.body?.params?.cursor === 'second'));
  for (const req of mcp.requests) assert.equal(req.headers.authorization, `Bearer ${mcpKey}`);
  assert.ok(!result.stdout.includes(mcpKey)); assert.ok(!result.stderr.includes(mcpKey));
  assert.ok(events(result.stdout).some(event => event.eventType === 'tool.approval_decided' && event.payload.approved));
});

test('production MCP never executes a call when stdin is not an approval terminal', async t => {
  const dir = directory(); let step = 0;
  const mcp = await mcpServer(t);
  const provider = await server(t, (_req, res) => step++ === 0 ? tool(res, 'mcp__notes__read', { id: 1 }) : completion(res, 'Approval was denied.'));
  const path = config(dir, provider.base, { mcp: httpConfig(`${mcp.base}/mcp`, false) });
  const result = await invoke(['--local', '--config', path, '--json', 'run', 'Read a note'], { dir, input: 'yes\n', env: { TEST_PROVIDER_KEY: key, MCP_KEY: mcpKey } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(mcp.requests.filter(req => req.body?.method === 'tools/call').length, 0);
  assert.ok(events(result.stdout).some(event => event.eventType === 'tool.completed' && event.payload.result.type === 'approval_denied'));
});

test('production stdio MCP uses explicit credentials and cwd, not parent auth/model environment, and closes its child', async t => {
  const dir = directory(); let step = 0;
  const dump = join(dir, 'env.json'); const cwd = join(dir, 'cwd.txt'); const pid = join(dir, 'pid.txt');
  const provider = await server(t, (_req, res) => step++ === 0 ? tool(res, 'mcp__notes__read', { id: 1 }) : completion(res, 'Read local note.'));
  const path = config(dir, provider.base, { mcp: { notes: { enabled: true, transport: 'stdio', command: process.execPath,
    args: [stdioFixture], cwd: dir, env: { NOTES_TOKEN: '{env:MCP_KEY}', MCP_FIXTURE: JSON.stringify({ tools: [read], envDumpPath: dump, cwdDumpPath: cwd, pidDumpPath: pid }) }, autoApprove: ['read'] } } });
  const result = await invoke(['--local', '--config', path, 'run', 'Read a local note'], { dir, env: { TEST_PROVIDER_KEY: key, MCP_KEY: mcpKey, LLAME_TOKEN: token } });
  assert.equal(result.code, 0, result.stderr);
  const childEnv = JSON.parse(readFileSync(dump, 'utf8'));
  assert.equal(childEnv.NOTES_TOKEN, mcpKey);
  for (const name of ['LLAME_TOKEN', 'TEST_PROVIDER_KEY', 'MCP_KEY', 'HOME']) assert.equal(childEnv[name], undefined, name);
  assert.equal(readFileSync(cwd, 'utf8'), dir);
  const childPid = Number(readFileSync(pid, 'utf8'));
  assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
});

test('production HTTP MCP refuses credential-bearing redirects before reaching their target', async t => {
  const dir = directory();
  const target = await server(t, (_req, res) => json(res, {}));
  const source = await server(t, (_req, res) => { res.writeHead(307, { location: target.base + '/collect' }); res.end(); });
  const path = config(dir, 'http://127.0.0.1:1', { mcp: httpConfig(`${source.base}/mcp`) });
  const result = await invoke(['--local', '--config', path, 'mcp', 'tools'], { dir, env: { MCP_KEY: mcpKey } });
  assert.equal(result.code, 1); assert.equal(source.requests.length, 1); assert.equal(target.requests.length, 0);
  assert.ok(!result.stderr.includes(mcpKey));
});

test('production MCP refuses a protocol revision outside the shared pinned client contract', async t => {
  const dir = directory(); const mcp = await mcpServer(t, { protocolVersion: '2099-01-01' });
  const path = config(dir, 'http://127.0.0.1:1', { mcp: httpConfig(`${mcp.base}/mcp`) });
  const result = await invoke(['--local', '--config', path, 'mcp', 'tools'], { dir, env: { MCP_KEY: mcpKey } });
  assert.equal(result.code, 1); assert.equal(mcp.requests.filter(req => req.body?.method === 'initialize').length, 1);
  assert.equal(mcp.requests.filter(req => req.body?.method === 'tools/list').length, 0);
});
