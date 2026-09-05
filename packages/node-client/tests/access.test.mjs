import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeAccessClient } from '../dist/access.js';
import { Remote } from '../dist/remote.js';
import { RemoteCursors } from '../dist/remote-cursors.js';
import { accessRequest, assertHttpBinding, parseNodeRequest, QUERY_METHODS, NODE_REQUEST_PATH, NODE_PRINCIPAL_HEADER, NODE_VERSION_HEADER } from '../../node-protocol/dist/index.js';
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const secret = 'private-session-value-abcdefg';
const description = () => ({ version: 1, kind: 'shared-instance', nodeId: null, principal: { kind: 'session-user', id: owner }, modules: { core: 1, realm: 1 },
  methods: ['core.describe', ...QUERY_METHODS], execution: 'hosted-queued', synchronization: false, enrollment: false,
  recall: { strategy: 'canonical-postgres', minimumQueryCharacters: 1 }, knowledge: 'live-markdown' });
const output = { protect() {}, text() {}, notice() {}, event() {}, value() {} };
const signal = () => AbortSignal.timeout(5000);
async function fixture(t, transform = value => value) {
  const calls = []; const dir = mkdtempSync(join(tmpdir(), 'node-client-'));
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.url, NODE_REQUEST_PATH); assert.equal(req.method, 'POST'); assert.equal(req.headers.authorization, `Bearer ${secret}`);
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = parseNodeRequest(JSON.parse(Buffer.concat(chunks).toString())); calls.push(input);
      assertHttpBinding(owner, req.headers[NODE_PRINCIPAL_HEADER], req.headers[NODE_VERSION_HEADER], input.method);
      const value = await accessRequest(input, { describe: description,
        query: async query => ({ status: 'success', results: [{ chatId: other, messageSeq: 1, excerpt: query.params.query ?? 'evidence' }] }),
      }, signal());
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(transform(value, input)));
    } catch { res.statusCode = 400; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const remote = new Remote({ authority: `http://127.0.0.1:${server.address().port}`, token: secret, userId: owner, source: 'file' }, new RemoteCursors(dir), output);
  return { remote, client: new NodeAccessClient(remote, { kind: 'shared-instance', principalId: owner }), calls };
}

test('the production HTTP client negotiates and sends bounded owner queries through the common dispatcher', async t => {
  const { client, calls } = await fixture(t);
  const result = await client.query('realm.conversations.search', { query: '日本語 notes' }, signal());
  assert.equal(result.principal.id, owner); assert.equal(result.data.results[0].excerpt, '日本語 notes');
  assert.deepEqual(calls.map(call => call.method), ['core.describe', 'realm.conversations.search']);
  assert.ok(!JSON.stringify(calls).includes(secret)); assert.ok(!JSON.stringify(calls).includes('userId'));
});

test('HTTP client rejects foreign principal, correlation mismatch, response owner drift and oversized responses', async t => {
  for (const mutation of [
    value => ({ ...value, id: 'different-request' }),
    value => value.result?.principal ? { ...value, result: { ...value.result, principal: { kind: 'session-user', id: other } } } : value,
    (value, input) => input.method === 'core.describe' ? value : { ...value, result: { ...value.result, principal: { kind: 'session-user', id: other } } },
    (value, input) => input.method === 'core.describe' ? value : { ...value, result: { ...value.result, source: { kind: 'personal-node', nodeId: other, synchronized: false } } },
    () => ({ text: 'x'.repeat(200_000) }),
  ]) {
    const { client } = await fixture(t, mutation);
    await assert.rejects(client.query('realm.conversations.search', { query: 'notes' }, signal()));
  }
});

test('client refuses unknown methods and owner-injecting parameters before HTTP I/O', async t => {
  const { remote, calls, client } = await fixture(t);
  await assert.rejects(remote.call('admin.recover', {}, signal()), { code: 'method_unavailable' });
  await assert.rejects(client.query('realm.conversations.search', { query: 'notes', userId: other }, signal()));
  assert.equal(calls.length, 0);
});

test('unavailable capabilities do not trigger a query or silent local fallback', async t => {
  const { client, calls } = await fixture(t, value => ({ ...value, result: { ...value.result, methods: ['core.describe'] } }));
  await assert.rejects(client.query('realm.knowledge.search', { query: 'notes' }, signal()), { code: 'capability_unavailable' });
  assert.equal(calls.length, 1);
});
