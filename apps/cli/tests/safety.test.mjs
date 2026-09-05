import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, symlinkSync, linkSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceFiles, digest } from '@workspace/personal-node/workspace-files';
import { WorkspaceTools } from '@workspace/personal-node/tools';
import { SecretStream, terminalText } from '@workspace/personal-node/output';
import { authority } from '@workspace/personal-node/validation';
import { privateDirectory, readPrivate, writePrivate } from '@workspace/personal-node/private-files';
import { commandEnvironment } from '@workspace/personal-node/env';
import { LocalStore } from '@workspace/personal-node/store';
import { skillMetadata } from '@workspace/personal-node/skills';
import { sse } from '@workspace/personal-node/http';
import { runLocal } from '@workspace/personal-node/local-run';
import { loadConfig, selectModel } from '@workspace/personal-node/config';
import { Output } from '../dist/output.js';
import { nativeProcess } from '@workspace/personal-node/native-process';
import { directory, workspace, server, config, key, tool, completion } from './helpers.mjs';

const signal = () => new AbortController().signal;

test('file tools reject traversal, absolute paths, symlinks, hardlinks, secrets and runtime state', () => {
  const dir = directory(); const root = workspace(dir); mkdirSync(join(root, 'state'));
  writeFileSync(join(root, '.env'), 'SECRET=x'); writeFileSync(join(root, 'normal.txt'), 'hello');
  const outside = join(dir, 'outside.txt'); writeFileSync(outside, 'private');
  symlinkSync(outside, join(root, 'symlink.txt')); linkSync(outside, join(root, 'hardlink.txt'));
  const files = new WorkspaceFiles(root, [join(root, 'state')]);
  for (const path of ['../outside.txt', outside, '.env', 'state', 'symlink.txt', 'hardlink.txt', '..\\outside.txt', 'C:secret']) {
    assert.throws(() => files.read(path), undefined, path);
  }
  assert.equal(files.read('normal.txt').content, 'hello');
  assert.deepEqual(files.list('.').entries.map((entry) => entry.name), ['normal.txt']);
});

test('atomic file edits preserve unrelated content and refuse stale preconditions', () => {
  const root = workspace(directory()); const files = new WorkspaceFiles(root, []);
  files.write('new.txt', 'first', 'absent'); const first = files.read('new.txt');
  assert.equal(first.sha256, digest('first'));
  assert.throws(() => files.write('new.txt', 'second', 'absent'), /changed/);
  files.write('new.txt', 'second', first.sha256);
  assert.throws(() => files.write('new.txt', 'third', first.sha256), /changed/);
  assert.equal(files.read('new.txt').content, 'second');
});

test('the approved edit is revalidated after approval, closing stale-approval races', async () => {
  const root = workspace(directory()); const files = new WorkspaceFiles(root, []);
  files.write('target', 'old', 'absent'); const expectedHash = files.read('target').sha256;
  const tools = new WorkspaceTools(files, async () => { writeFileSync(join(root, 'target'), 'human edit'); return true; }, {}, () => {});
  await tools.execute('workspace_enter', {}, signal());
  await assert.rejects(() => tools.execute('write_file', { path: 'target', expectedHash, content: 'model edit' }, signal()), /changed/);
  assert.equal(files.read('target').content, 'human edit');
});

test('a full approved model/tool loop edits a real file and records the exact hash and observation', async (t) => {
  const dir = directory(); const root = workspace(dir); let step = 0; const approvals = [];
  const provider = await server(t, (request, response) => {
    if (step++ === 0) tool(response, 'workspace_enter', {}, 'enter');
    else if (step === 2) tool(response, 'write_file', { path: 'generated.txt', expectedHash: 'absent', content: 'verified output\n' }, 'write');
    else {
      assert.equal(JSON.parse(request.body.messages.at(-1).content).sha256, digest('verified output\n'));
      completion(response, 'Created generated.txt.');
    }
  });
  const path = config(dir, provider.base); const cfg = loadConfig(path, { TEST_PROVIDER_KEY: key });
  const store = new LocalStore(join(dir, 'state')); t.after(() => store.close());
  const id = await runLocal({ store, config: cfg, model: selectModel(cfg), chatId: randomUUID(), prompt: 'make a file',
    cwd: root, configPath: path, native: true, approve: async (description) => { approvals.push(description); return true; },
    processEnv: commandEnvironment({ PATH: process.env.PATH }), signal: signal(), output: new Output(false) });
  assert.equal(readFileSync(join(root, 'generated.txt'), 'utf8'), 'verified output\n');
  assert.equal(approvals.length, 1); assert.match(approvals[0], /verified output/);
  assert.ok(store.events(id).some((event) => event.eventType === 'side_effect.started'));
  assert.equal(store.run(id).status, 'completed');
});

test('native process receives only a narrow environment and is killed as a group on cancellation', async () => {
  const root = workspace(directory());
  const safe = commandEnvironment({ PATH: process.env.PATH, LLAME_TOKEN: 'never-child', TEST_PROVIDER_KEY: key, HOME: '/private-home' });
  const result = await nativeProcess(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], root, safe, signal());
  assert.equal(result.code, 0); assert.ok(!result.output.includes(key)); assert.ok(!result.output.includes('never-child')); assert.ok(!result.output.includes('/private-home'));
  const controller = new AbortController();
  const running = nativeProcess(process.execPath, ['-e', 'setInterval(()=>{},100)'], root, safe, controller.signal);
  setTimeout(() => controller.abort(), 75); const aborted = await running;
  assert.equal(aborted.stopped, 'cancelled');
});

test('native process output is actually bounded, not merely truncated after unbounded buffering', async () => {
  const result = await nativeProcess(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("a".repeat(10000)),1)'],
    workspace(directory()), commandEnvironment({ PATH: process.env.PATH }), signal());
  assert.equal(result.stopped, 'output_limit'); assert.ok(Buffer.byteLength(result.output) <= 16_000);
});

test('recover settles repeated tool IDs from the interrupted run without replaying old runs', () => {
  const store = new LocalStore(join(directory(), 'state')); const chat = randomUUID();
  try {
    const first = store.start(chat, 'first', {});
    const call = { id: 'repeated', type: 'function', function: { name: 'write_file', arguments: '{}' } };
    store.message(chat, first, { role: 'assistant', content: null, tool_calls: [call] });
    store.message(chat, first, { role: 'tool', tool_call_id: 'repeated', content: '{"status":"success"}' }); store.finish(first, 'completed');
    const second = store.start(chat, 'second', {});
    store.message(chat, second, { role: 'assistant', content: null, tool_calls: [call] }); store.recover();
    assert.equal(store.run(second).status, 'interrupted');
    const observation = store.history(chat).at(-1); assert.equal(observation.tool_call_id, 'repeated');
    assert.equal(JSON.parse(observation.content).type, 'outcome_unknown');
  } finally { store.close(); }
});

test('instruction-only skills are lazy, source-labelled and never execute scripts or grant permissions', async () => {
  const root = workspace(directory()); mkdirSync(join(root, '.agents/skills/example'), { recursive: true });
  writeFileSync(join(root, '.agents/skills/example/SKILL.md'), '---\nname: example\ndescription: >-\n  Example instruction\n  package\nallowed-tools: Bash(*)\n---\nUse concise descriptions.');
  const files = new WorkspaceFiles(root, []); const audit = [];
  const tools = new WorkspaceTools(files, async () => false, {}, (type) => audit.push(type));
  await assert.rejects(() => tools.execute('skills_list', {}, signal()), /Enter/);
  await tools.execute('workspace_enter', {}, signal());
  const list = await tools.execute('skills_list', {}, signal()); assert.equal(list.skills[0].description, 'Example instruction package');
  assert.equal(audit.includes('skill.loaded'), false);
  const loaded = await tools.execute('skill_load', { name: 'example' }, signal());
  assert.equal(loaded.sha256, digest(files.read('.agents/skills/example/SKILL.md').content));
  assert.match(loaded.notice, /No permission grants/); assert.equal(audit.includes('skill.loaded'), true);
  await assert.rejects(() => tools.execute('skill_load', { name: '../secret' }, signal()));
});

test('secret-stream redaction handles every split boundary and overlapping values', () => {
  for (let index = 0; index < key.length; index++) {
    const stream = new SecretStream([key]);
    assert.equal(stream.push(`start ${key.slice(0, index)}`) + stream.push(`${key.slice(index)} end`) + stream.push('', true), 'start [REDACTED] end');
  }
  const stream = new SecretStream(['abc', 'abcdef']);
  assert.equal(stream.push('abc') + stream.push('def!') + stream.push('', true), '[REDACTED]!');
  assert.equal(terminalText('\x1b]52;c;abcd\x07\u202ehello\r'), ']52;c;abcdhello');
});

test('SSE handles one-byte UTF-8 packets, CRLF boundaries, multiline data and CR-only EOF', async () => {
  const source = new TextEncoder().encode('id: 7\r\ndata: héllo\r\ndata: world\r\n\r\n: keepalive\r\rid: 8\rdata: done\r\r');
  const body = new ReadableStream({ start(controller) { for (const byte of source) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const frames = [];
  for await (const frame of sse(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))) frames.push(frame);
  assert.deepEqual(frames.map(({ id, data }) => ({ id, data })), [{ id: '7', data: 'héllo\nworld' }, { id: '8', data: 'done' }]);
});

test('SSE rejects oversized and incomplete events without accepting a fake completed result', async () => {
  await assert.rejects(async () => {
    for await (const _frame of sse(new Response(`data: ${'x'.repeat(1_048_580)}`, { headers: { 'content-type': 'text/event-stream' } }))) {}
  }, /exceeds/);
  const frames = [];
  for await (const frame of sse(new Response('data: {"unfinished":true}', { headers: { 'content-type': 'text/event-stream' } }))) frames.push(frame);
  assert.deepEqual(frames, []);
});

test('URL and private-file boundaries fail closed without changing unrelated directory permissions', () => {
  for (const url of ['http://example.com', 'https://u:p@example.com', 'https://example.com/?token=x', 'file:///tmp', 'http://localhost:8080']) assert.throws(() => authority(url));
  assert.equal(authority('https://example.com/base/'), 'https://example.com/base');
  const dir = directory(); const file = join(dir, 'private.json');
  writePrivate(file, '{"a":1}', false); assert.equal(readPrivate(file), '{"a":1}');
  assert.throws(() => writePrivate(file, 'overwrite', false));
  const linked = join(dir, 'linked'); symlinkSync(file, linked); assert.throws(() => readPrivate(linked));
  assert.equal(statSync(file).mode & 0o777, 0o600);
});
