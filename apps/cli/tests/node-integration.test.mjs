import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { invoke, server, json, directory, token, userId, chatId } from './helpers.mjs';
import { accessRequest, assertHttpBinding, parseNodeRequest, QUERY_METHODS } from '../../../packages/node-protocol/dist/index.js';

const description = { version: 1, kind: 'shared-instance', nodeId: null, principal: { kind: 'session-user', id: userId }, modules: { core: 1, realm: 1 },
  methods: ['core.describe', ...QUERY_METHODS], execution: 'hosted-queued', synchronization: false, enrollment: false,
  recall: { strategy: 'canonical-postgres', minimumQueryCharacters: 1 }, knowledge: 'live-markdown' };

test('saved remote selects Node capabilities and all canonical read commands without starting a personal database', async t => {
  const dir = directory(); const observed = [];
  const hub = await server(t, async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    if (req.path === '/auth/v1/me') return json(res, { id: userId });
    assert.equal(req.path, '/api/v1/node/requests'); const input = parseNodeRequest(req.body);
    assertHttpBinding(userId, req.headers['x-llame-node-principal'], req.headers['x-llame-node-version'], input.method);
    const result = await accessRequest(input, { describe: () => description, query: async operation => {
      observed.push(operation); return { status: 'success', content: 'bounded source evidence', results: [] };
    } }, AbortSignal.timeout(5000));
    return json(res, result);
  });
  assert.equal((await invoke(['remote', 'enable', hub.base], { dir })).code, 0);
  const env = { LLAME_TOKEN: token, LLAME_TOKEN_FOR: hub.base };
  const caps = await invoke(['--json', 'node', 'capabilities'], { dir, env });
  assert.equal(caps.code, 0, caps.stderr); assert.equal(JSON.parse(caps.stdout).kind, 'shared-instance');
  assert.equal(JSON.parse(caps.stdout).authority, hub.base);
  for (const args of [['chats', 'read', chatId, '1', '0', '40'], ['knowledge', 'search', 'notas 日本語'], ['knowledge', 'read', chatId, 'notes.md', '0', '40']]) {
    const reply = await invoke(['--json', ...args], { dir, env }); assert.equal(reply.code, 0, reply.stderr);
    const result = JSON.parse(reply.stdout); assert.equal(result.status, 'success'); assert.equal(result.node.principal.id, userId); assert.equal(result.node.authority, hub.base);
  }
  assert.deepEqual(observed.map(op => op.method), ['realm.conversations.read', 'realm.knowledge.search', 'realm.knowledge.read']);
  assert.equal(observed[0].params.messageSeq, 1); assert.equal(observed[0].params.limit, 40);
  assert.equal(existsSync(join(dir, 'state/state.sqlite')), false);
  const before = hub.requests.length;
  const local = await invoke(['--local', '--json', 'node', 'capabilities'], { dir });
  assert.equal(local.code, 0, local.stderr); assert.equal(JSON.parse(local.stdout).kind, 'personal-node');
  assert.equal(hub.requests.length, before);
});

test('thin clients contain neither hosted domain imports nor local execution/storage imports', () => {
  for (const root of [new URL('../src/', import.meta.url), new URL('../../../packages/node-client/src/', import.meta.url)]) {
    for (const file of readdirSync(root).filter(name => name.endsWith('.ts'))) {
      const source = readFileSync(new URL(file, root), 'utf8');
      assert.doesNotMatch(source, /(?:from|import\()\s*['"][^'"]*(?:apps\/api|personal-node\/(?:store|local-run|mcp-host|native-tools|node-service))['"]/u, file);
    }
  }
});
