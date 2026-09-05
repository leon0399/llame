import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { JsonLines } from '../dist/json-lines.js';
import { NodeSession } from '../dist/node-session.js';
import { NodeService } from '../dist/node-service.js';
import { nodeRequest } from '../dist/protocol.js';
import { NodeOutput } from '../dist/node-output.js';

function session(t) {
  const data = mkdtempSync(join(tmpdir(), 'llame-node-protocol-'));
  const service = new NodeService({ data, config: join(data, 'config.json'), cwd: data, native: false, transport: 'stdio', env: {} });
  const input = new PassThrough(); const output = new PassThrough(); const frames = [];
  const reader = new JsonLines(12582912, frame => frames.push(frame)); output.on('data', data => reader.push(data));
  const channel = new NodeSession(service, input, output, false);
  t.after(async () => { channel.close(true); input.destroy(); output.destroy(); await channel.settled(); await service.stop(); });
  return { service, input, output, frames, channel, send: (id, method, params = {}) => input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') };
}

test('framing preserves split multibyte UTF-8 and rejects invalid, oversized and non-JSON frames', () => {
  const got = []; const parser = new JsonLines(100, value => got.push(value));
  const bytes = Buffer.from('{"query":"日本語 привет"}\n');
  for (const byte of bytes) parser.push(Buffer.from([byte])); assert.deepEqual(got, [{ query: '日本語 привет' }]);
  parser.push(Buffer.from('\n{}\n{}\n')); assert.equal(got.length, 3);
  for (const buffer of [Buffer.from([0xff, 10]), Buffer.from('{broken}\n')]) assert.throws(() => new JsonLines(100, () => {}).push(buffer), { code: 'protocol_json' });
  assert.throws(() => new JsonLines(8, () => {}).push(Buffer.from('123456789')), { code: 'protocol_limit' });
  assert.throws(() => new JsonLines(8, () => {}).push(Buffer.from('123456789\n')), { code: 'protocol_limit' });
});

test('request schema rejects caller identity injection, batches and invalid JSON-RPC versions', () => {
  assert.throws(() => nodeRequest([{ method: 'core.status' }]), { code: 'invalid_data' });
  assert.throws(() => nodeRequest({ jsonrpc: '1.0', id: 'a', method: 'core.status' }), { code: 'protocol' });
  assert.throws(() => nodeRequest({ jsonrpc: '2.0', id: 'a', method: 'core.status', userId: 'injected' }), { code: 'unknown_field' });
  assert.throws(() => nodeRequest({ jsonrpc: '2.0', id: 1, method: 'core.status' }), { code: 'invalid_data' });
  assert.throws(() => nodeRequest({ jsonrpc: '2.0', id: 'a', method: 'core.status', params: [] }), { code: 'invalid_data' });
});

test('duplicate request IDs cannot replay a resource mutation and incomplete EOF does not execute', async t => {
  const s = session(t); s.send('hello', 'core.hello', { version: 2 }); await delay(0);
  s.send('create', 'realm.knowledge.create', { name: 'One resource' }); await delay(0);
  s.send('create', 'realm.knowledge.create', { name: 'Replay' }); await delay(0);
  s.input.write('{"jsonrpc":"2.0","id":"partial","method":"realm.knowledge.create","params":{"name":"Not framed"}}');
  s.input.end(); // a complete object without its framing newline is not executed
  await delay(0);
  assert.equal(s.frames.filter(frame => frame.id === 'create' && frame.result).length, 1);
  assert.equal(s.frames.find(frame => frame.id === 'create' && frame.error).error.data.code, 'request_duplicate');
  assert.equal(s.frames.some(frame => frame.id === 'partial'), false);
  assert.equal(s.service.store.db.prepare('SELECT COUNT(*) AS count FROM knowledge_spaces').get().count, 1);
});

test('core negotiation cannot be repeated and unsupported capabilities are explicit', async t => {
  const s = session(t); s.send('first', 'core.hello', { version: 2 }); await delay(0);
  const hello = s.frames.find(frame => frame.id === 'first').result;
  assert.deepEqual(Object.keys(hello.modules), ['core', 'realm', 'execution', 'admin']); assert.equal(hello.synchronization, false);
  s.send('again', 'core.hello', { version: 2 }); s.send('missing', 'sync.exchange'); await delay(0);
  assert.equal(s.frames.find(frame => frame.id === 'again').error.data.code, 'protocol_sequence');
  assert.equal(s.frames.find(frame => frame.id === 'missing').error.code, -32601);
});

test('credentials are redacted before crossing any Node output channel', () => {
  const secret = 'private-model-secret-abcdefghi'; const sent = []; const output = new NodeOutput((kind, value) => sent.push({ kind, value }));
  output.protect([secret]); output.text(secret); output.notice(`contains ${secret}`);
  output.event({ eventType: 'safe', payload: { value: secret } });
  output.event({ eventType: 'unsafe-key', payload: { [secret]: 'blocked' } });
  assert.ok(!JSON.stringify(sent).includes(secret)); assert.equal(sent.at(-1).value.withheld, true);
});
