import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accessRequest, parseNodeRequest, queryParams, nodeDescription, assertHttpBinding, QUERY_METHODS,
  nodeOpenApiPaths, nodeAdmissionSchemas, nodeProtocolSchemas } from '../dist/index.js';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
export function description(id = owner, methods = QUERY_METHODS) {
  return { version: 1, kind: 'shared-instance', nodeId: null, principal: { kind: 'session-user', id }, modules: { core: 1, realm: 1 },
    methods: ['core.describe', ...methods], execution: 'hosted-queued', synchronization: false, enrollment: false,
    recall: { strategy: 'canonical-postgres', minimumQueryCharacters: 1 }, knowledge: 'live-markdown' };
}
const request = (method, params = {}) => parseNodeRequest({ jsonrpc: '2.0', id: 'request', method, params });
const signal = () => AbortSignal.timeout(1000);

test('shared schema rejects batches, notifications, identity fields and unknown methods', () => {
  for (const input of [[], null, { jsonrpc: '2.0', method: 'core.describe' }, { jsonrpc: '1.0', id: 'a', method: 'core.describe' },
    { jsonrpc: '2.0', id: 'a', method: 'core.describe', userId: other }, { jsonrpc: '2.0', id: 'a', method: 'core.describe', params: null }]) assert.throws(() => parseNodeRequest(input));
  for (const field of ['userId', 'principal', 'token', 'tools', 'root', 'native']) {
    assert.throws(() => queryParams('realm.conversations.search', { query: 'notes', [field]: other }));
  }
  for (const method of ['admin.recover', 'tools.call', 'sync.exchange', 'execution.run', '__proto__']) {
    assert.throws(() => queryParams(method, {}), { code: 'method_unavailable' });
  }
});

test('range, path and multilingual query validation preserve literal source coordinates', () => {
  assert.deepEqual(queryParams('realm.conversations.search', { query: '日本語 и notas' }).params, { query: '日本語 и notas', limit: 5 });
  assert.throws(() => queryParams('realm.conversations.search', { query: 'notes', limit: null }));
  assert.equal(queryParams('realm.conversations.search', { query: '🌍'.repeat(200) }).params.query, '🌍'.repeat(200));
  assert.throws(() => queryParams('realm.conversations.search', { query: '🌍'.repeat(201) }));
  for (const query of ['', ' ', 'a'.repeat(201)]) assert.throws(() => queryParams('realm.knowledge.search', { query }));
  for (const path of ['/etc/passwd', '../secret', 'notes/../secret', 'C:/secret', 'a\\b', 'a//b', '.', 'a/./b']) {
    assert.throws(() => queryParams('realm.knowledge.read', { knowledgeSpaceId: owner, path }));
  }
  for (const params of [{ chatId: other, messageSeq: 0 }, { chatId: owner, messageSeq: 1, offset: null }, { chatId: owner, messageSeq: 1, limit: null }, { chatId: owner, messageSeq: 1, limit: 2001 },
    { chatId: owner, messageSeq: 1, offset: Number.MAX_SAFE_INTEGER + 1 }, { chatId: 'foreign', messageSeq: 1 }]) {
    assert.throws(() => queryParams('realm.conversations.read', params));
  }
});

test('identity header only asserts the session principal; discovery does not grant enrollment', () => {
  assert.doesNotThrow(() => assertHttpBinding(owner, undefined, '1', 'core.describe'));
  assert.doesNotThrow(() => assertHttpBinding(owner, owner, '1', 'realm.conversations.search'));
  for (const expected of [undefined, other, [owner, other]]) assert.throws(() => assertHttpBinding(owner, expected, '1', 'realm.conversations.search'));
  assert.throws(() => assertHttpBinding(owner, other, '1', 'core.describe'));
  assert.throws(() => assertHttpBinding(owner, owner, '2', 'core.describe'));
  assert.equal(nodeDescription(description()).enrollment, false);
  for (const patch of [{ synchronization: true }, { nodeId: owner }, { execution: 'private-ipc' }, { methods: ['core.describe', 'admin.recover'] },
    { principal: { kind: 'local-owner', id: owner } }, { version: 2 }]) assert.throws(() => nodeDescription({ ...description(), ...patch }));
});

test('bound port produces method/principal/source receipts and never calls unavailable operations', async () => {
  const calls = [];
  const port = { describe: () => description(), query: async (query) => { calls.push(query); return { status: 'success', results: [] }; } };
  const reply = await accessRequest(request('realm.conversations.search', { query: 'notes' }), port, signal());
  assert.equal(reply.id, 'request'); assert.equal(reply.result.principal.id, owner);
  assert.equal(reply.result.method, 'realm.conversations.search'); assert.equal(reply.result.source.synchronized, false);
  const denied = await accessRequest(request('realm.knowledge.search', { query: 'notes' }), { ...port, describe: () => description(owner, []) }, signal());
  assert.equal(denied.error.data.code, 'capability_unavailable'); assert.equal(calls.length, 1);
  const badIdentity = await accessRequest(request('core.describe', { userId: other }), port, signal());
  assert.ok(badIdentity.error); assert.equal(calls.length, 1);
});

test('cancelled, oversized and exceptional operations never leak private exceptions or source data', async () => {
  const secret = 'private-exception-source-secret'; let calls = 0;
  const port = { describe: () => description(), query: async () => { calls++; throw Error(secret); } };
  const req = request('realm.conversations.search', { query: 'notes' });
  const cancelled = await accessRequest(req, port, AbortSignal.abort());
  assert.equal(cancelled.error.data.code, 'cancelled'); assert.equal(calls, 0);
  const failed = await accessRequest(req, port, signal()); assert.equal(failed.error.data.code, 'operation_failed');
  assert.ok(!JSON.stringify(failed).includes(secret));
  const oversized = await accessRequest(req, { ...port, query: async () => ({ status: 'success', text: 'x'.repeat(131073) }) }, signal());
  assert.equal(oversized.error.data.code, 'result_limit'); assert.equal(oversized.result, undefined);
  const wrong = await accessRequest(req, { ...port, query: async () => ({ access: 'granted' }) }, signal());
  assert.equal(wrong.error.data.code, 'result_invalid');
});

test('checked-in shared OpenAPI operations and admission schemas exactly match their production generator', () => {
  const document = JSON.parse(readFileSync(new URL('../../../apps/api/openapi.json', import.meta.url)));
  for (const [path, value] of Object.entries(nodeOpenApiPaths())) assert.deepEqual(document.paths[path], value);
  for (const [name, value] of Object.entries({ ...nodeAdmissionSchemas(document.components.schemas.CreateMessageDto), ...nodeProtocolSchemas() })) assert.deepEqual(document.components.schemas[name], value);
  assert.throws(() => nodeAdmissionSchemas({}));
});
