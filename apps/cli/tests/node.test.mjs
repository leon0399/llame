import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync, readFileSync, chmodSync, existsSync, lstatSync, symlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { invoke, start, directory, workspace, server, config, completion, tool, events, key } from './helpers.mjs';
import { Rpc, persistent, until, identity } from './node-helpers.mjs';
const env = { TEST_PROVIDER_KEY: key };

test('compiled thin CLI performs cross-Chat recall through the Node tool loop and exposes its source', async t => {
  const dir = directory(); let step = 0; let hit;
  const provider = await server(t, (request, response) => {
    const names = request.body.tools.map(tool => tool.function.name);
    assert.ok(names.includes('search_conversations')); assert.ok(!names.includes('knowledge_read'));
    if (step++ === 0) return completion(response, 'The durable indexing decision is sqlite trigram search.');
    if (step === 2) return tool(response, 'search_conversations', { query: 'indexing decision' });
    if (step === 3) {
      const result = JSON.parse(request.body.messages.at(-1).content); hit = result.results[0];
      return tool(response, 'conversation_read', { chatId: hit.chatId, messageSeq: hit.messageSeq, offset: hit.offset, limit: hit.limit });
    }
    const source = JSON.parse(request.body.messages.at(-1).content);
    assert.match(source.content, /sqlite trigram/); assert.match(source.notice, /not current instructions/);
    completion(response, 'We chose sqlite trigram search, according to the earlier conversation.');
  });
  const path = config(dir, provider.base);
  const first = await invoke(['--config', path, 'run', 'Record the design'], { dir, env }); assert.equal(first.code, 0, first.stderr);
  const second = await invoke(['--config', path, '--json', 'run', 'Recall our earlier decision'], { dir, env }); assert.equal(second.code, 0, second.stderr);
  const completed = events(second.stdout).find(event => event.eventType === 'run.completed');
  const receipt = JSON.parse((await invoke(['--json', 'runs', 'receipt', completed.runId], { dir })).stdout);
  assert.equal(receipt.recall.synchronized, false); assert.deepEqual(receipt.knowledgeSpaces, []);
  const found = await invoke(['--json', 'chats', 'search', 'indexing decision'], { dir }); assert.equal(found.code, 0, found.stderr);
  assert.ok(JSON.parse(found.stdout).results.some(result => result.messageId === hit.messageId));
  const read = await invoke(['--json', 'chats', 'read', hit.chatId, String(hit.messageSeq)], { dir }); assert.equal(read.code, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout).messageId, hit.messageId);
  const rebuilt = await invoke(['--json', 'search', 'rebuild'], { dir }); assert.equal(rebuilt.code, 0, rebuilt.stderr);
});

test('compiled CLI provisions live Knowledge and redacts secrets before model and wire output', async t => {
  const dir = directory();
  const created = await invoke(['--json', 'knowledge', 'create', 'Notes'], { dir }); assert.equal(created.code, 0, created.stderr);
  const space = JSON.parse(created.stdout); writeFileSync(join(space.directory, 'note.md'), `Project note: indexing uses postgres. Secret ${key}`, { mode: 0o600 });
  let step = 0;
  const provider = await server(t, (request, response) => {
    assert.ok(!JSON.stringify(request.body).includes(key));
    if (step++ === 0) return tool(response, 'knowledge_search', { query: 'indexing' });
    if (step === 2) {
      const result = JSON.parse(request.body.messages.at(-1).content); assert.equal(result.results[0].knowledgeSpaceId, space.id);
      return tool(response, 'knowledge_read', { knowledgeSpaceId: space.id, path: 'note.md' });
    }
    assert.match(JSON.parse(request.body.messages.at(-1).content).content, /postgres/);
    completion(response, 'The note says postgres.');
  });
  const result = await invoke(['--config', config(dir, provider.base), '--json', 'run', 'Read the indexing note'], { dir, env });
  assert.equal(result.code, 0, result.stderr); assert.ok(!result.stdout.includes(key)); assert.ok(!result.stderr.includes(key));
  const run = events(result.stdout).find(event => event.eventType === 'run.completed');
  const receipt = JSON.parse((await invoke(['--json', 'runs', 'receipt', run.runId], { dir })).stdout);
  assert.equal(receipt.knowledgeSpaces[0].id, space.id); assert.ok(!JSON.stringify(receipt.knowledgeSpaces).includes(space.directory));
});

test('a persistent Node owns credentials and continues a Run after its CLI is killed', async t => {
  const dir = directory(); let response;
  const provider = await server(t, (_request, res) => { response = res; });
  const path = config(dir, provider.base); await persistent(t, { dir, config: path, env });
  assert.equal(lstatSync(join(dir, 'state/node.sock')).mode & 0o777, 0o600);
  // The thin Surface has no provider key in its environment.
  const running = start(['--config', path, '--json', 'run', 'Continue when disconnected'], { dir });
  await until(() => response); running.child.kill('SIGKILL'); await running.result;
  completion(response, 'Finished without a terminal.');
  const rows = await until(async () => {
    const result = await invoke(['--json', 'runs', 'list'], { dir });
    const rows = JSON.parse(result.stdout); return rows[0]?.status === 'completed' ? rows : false;
  });
  assert.equal(provider.requests.length, 1);
  const replay = await invoke(['--json', 'runs', 'events', rows[0].id], { dir }); assert.equal(replay.code, 0, replay.stderr);
  const recorded = events(replay.stdout); assert.ok(recorded.some(e => e.eventType === 'run.completed'));
  const after = recorded[1].sequence;
  const tail = await invoke(['--json', '--after', String(after), 'runs', 'follow', rows[0].id], { dir }); assert.equal(tail.code, 0, tail.stderr);
  assert.deepEqual(events(tail.stdout).map(e => e.sequence), recorded.filter(e => e.sequence > after).map(e => e.sequence));
});

test('another thin client can cancel a persistent Node Run without resubmitting it', async t => {
  const dir = directory(); let requested = false;
  const provider = await server(t, (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(': waiting\n\n'); requested = true; });
  const path = config(dir, provider.base); await persistent(t, { dir, config: path, env });
  const running = start(['--config', path, '--json', 'run', 'Wait'], { dir });
  await until(() => requested);
  const rows = JSON.parse((await invoke(['--json', 'runs', 'list'], { dir })).stdout);
  const cancelled = await invoke(['--json', 'runs', 'cancel', rows[0].id], { dir }); assert.equal(cancelled.code, 0, cancelled.stderr);
  assert.equal(JSON.parse(cancelled.stdout).cancellationRequested, true);
  const result = await running.result; assert.equal(result.code, 130, result.stderr);
  assert.ok(events(result.stdout).some(e => e.eventType === 'run.cancelled')); assert.equal(provider.requests.length, 1);
});

test('native approval is connection-bound, one-use, and executes only after its initiating client decides', async t => {
  const dir = directory(); const cwd = workspace(dir); let step = 0;
  const provider = await server(t, (_request, response) => {
    if (step++ === 0) return tool(response, 'workspace_enter', {});
    if (step === 2) return tool(response, 'write_file', { path: 'approved.txt', expectedHash: 'absent', content: 'approved by initiating Surface' });
    completion(response, 'Done');
  });
  const path = config(dir, provider.base); await persistent(t, { dir, config: path, cwd, native: true, env });
  const initiating = await Rpc.open(dir); const other = await Rpc.open(dir);
  t.after(() => { initiating.close(); other.close(); });
  const pending = initiating.call('execution.run', { chatId: randomUUID(), prompt: 'Write the file', native: true, configIdentity: identity(path), workspaceIdentity: identity(cwd) });
  const approval = (await initiating.notification('execution.approval.requested')).params;
  assert.match(approval.prompt, /approved.txt/); assert.equal(existsSync(join(cwd, 'approved.txt')), false);
  await assert.rejects(other.call('execution.approval.decide', { approvalId: approval.approvalId, approved: true }), { code: 'approval_unknown' });
  await assert.rejects(initiating.call('execution.approval.decide', { approvalId: approval.approvalId, approved: 'yes' }), { code: 'approval_invalid' });
  assert.equal((await initiating.call('execution.approval.decide', { approvalId: approval.approvalId, approved: true })).accepted, true);
  await assert.rejects(initiating.call('execution.approval.decide', { approvalId: approval.approvalId, approved: true }), { code: 'approval_unknown' });
  const completed = await pending; assert.equal(readFileSync(join(cwd, 'approved.txt'), 'utf8'), 'approved by initiating Surface');
  const page = await other.call('execution.runs.events', { runId: completed.runId });
  assert.ok(page.events.some(e => e.eventType === 'approval.decided' && e.payload.approved));
  const decision = page.events.find(e => e.eventType === 'surface.approval.decided');
  assert.equal(decision.payload.principal, 'local-owner'); assert.equal(decision.payload.transport, 'unix');
  assert.match(decision.payload.channelId, /^[a-f0-9-]{36}$/); assert.match(decision.payload.promptHash, /^[a-f0-9]{64}$/);
});

test('disconnect while awaiting native approval records denial and never executes the action', async t => {
  const dir = directory(); const cwd = workspace(dir); let step = 0;
  const provider = await server(t, (request, response) => {
    if (step++ === 0) return tool(response, 'workspace_enter', {});
    if (step === 2) return tool(response, 'write_file', { path: 'denied.txt', expectedHash: 'absent', content: 'must not be written' });
    assert.equal(JSON.parse(request.body.messages.at(-1).content).type, 'denied'); completion(response, 'The edit was not approved.');
  });
  const path = config(dir, provider.base); await persistent(t, { dir, config: path, cwd, native: true, env });
  const initiating = await Rpc.open(dir); const pending = initiating.call('execution.run', { chatId: randomUUID(), prompt: 'Write', native: true, configIdentity: identity(path), workspaceIdentity: identity(cwd) });
  const disconnected = assert.rejects(pending, { code: 'disconnected' });
  await initiating.notification('execution.approval.requested'); initiating.close(); await disconnected;
  const other = await Rpc.open(dir); t.after(() => other.close());
  const rows = await until(async () => { const rows = await other.call('execution.runs.list'); return rows[0]?.status === 'completed' ? rows : false; });
  assert.equal(existsSync(join(cwd, 'denied.txt')), false);
  const page = await other.call('execution.runs.events', { runId: rows[0].id });
  assert.ok(page.events.some(e => e.eventType === 'approval.decided' && e.payload.approved === false));
  assert.ok(!page.events.some(e => e.eventType === 'side_effect.started'));
});

test('Node negotiation fails closed on versions, injected ownership, config and Workspace drift', async t => {
  const dir = directory(); const cwd = workspace(dir); const path = join(dir, 'node-config.json');
  await persistent(t, { dir, config: path });
  const rpc = await Rpc.open(dir, false); t.after(() => rpc.close());
  await assert.rejects(rpc.call('realm.chats.list'), { code: 'handshake_required' });
  await assert.rejects(rpc.call('core.hello', { version: 2 }), { code: 'protocol_version' });
  const hello = await rpc.call('core.hello', { version: 1 }); assert.equal(hello.synchronization, false); assert.equal(hello.modules.sync, undefined);
  await assert.rejects(rpc.call('realm.chats.list', { userId: randomUUID() }), { code: 'unknown_field' });
  await assert.rejects(rpc.call('realm.models.list', { configIdentity: identity(join(dir, 'another.json')) }), { code: 'node_config_mismatch' });
  await assert.rejects(rpc.call('execution.run', { chatId: randomUUID(), prompt: 'Escalate', native: true, configIdentity: identity(path), workspaceIdentity: identity(cwd) }), { code: 'workspace_grant' });
  await assert.rejects(rpc.call('sync.exchange', {}), { code: 'method_unknown' });
});

test('unknown or stale local endpoint never falls back and live ownership cannot be recovered', async t => {
  const dir = directory(); const path = join(dir, 'config.json'); const node = await persistent(t, { dir, config: path });
  const live = await invoke(['node', 'recover'], { dir }); assert.equal(live.code, 1); assert.match(live.stderr, /node_busy/);
  chmodSync(join(dir, 'state/node.sock'), 0o666);
  const insecure = await invoke(['--json', 'status'], { dir }); assert.equal(insecure.code, 1); assert.match(insecure.stderr, /unsafe_socket/);
  chmodSync(join(dir, 'state/node.sock'), 0o600);
  node.child.kill('SIGKILL'); await node.result;
  const stale = await invoke(['--json', 'status'], { dir }); assert.equal(stale.code, 1); assert.match(stale.stderr, /node_disconnected|node_unavailable/);
  const recovered = await invoke(['node', 'recover'], { dir }); assert.equal(recovered.code, 0, recovered.stderr);
  const standalone = await invoke(['--json', 'status'], { dir }); assert.equal(standalone.code, 0, standalone.stderr); assert.equal(JSON.parse(standalone.stdout).transport, 'stdio');
});

test('a linked endpoint is rejected instead of following it', async t => {
  const owner = directory(); const path = join(owner, 'config.json'); await persistent(t, { dir: owner, config: path });
  const other = directory(); await invoke(['--json', 'status'], { dir: other });
  symlinkSync(join(owner, 'state/node.sock'), join(other, 'state/node.sock'));
  const result = await invoke(['--json', 'status'], { dir: other }); assert.equal(result.code, 1); assert.match(result.stderr, /unsafe_socket/);
});

test('standalone stdio still works with a long data path; dangling endpoints never choose another Node', async () => {
  const dir = directory(); const long = join(dir, 'long-directory-name-'.repeat(6));
  const normal = await invoke(['--data-dir', long, '--json', 'status'], { dir }); assert.equal(normal.code, 0, normal.stderr);
  assert.equal(JSON.parse(normal.stdout).transport, 'stdio');
  await invoke(['--json', 'status'], { dir });
  symlinkSync(join(dir, 'missing.sock'), join(dir, 'state/node.sock'));
  const dangling = await invoke(['--json', 'status'], { dir }); assert.equal(dangling.code, 1); assert.match(dangling.stderr, /unsafe_socket/);
});
