import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { invoke, server, completion, tool, config, directory, workspace, events, frames, key, start } from './helpers.mjs';

const env = { TEST_PROVIDER_KEY: key };

test('help/version and a provider-free local node work without an account', async () => {
  const dir = directory();
  assert.equal((await invoke(['--help'], { dir })).code, 0);
  const status = await invoke(['--json', 'status'], { dir });
  assert.equal(status.code, 0);
  const state = JSON.parse(status.stdout); assert.equal(state.mode, 'local'); assert.equal(state.enrolled, false);
  assert.equal(JSON.parse((await invoke(['--json', 'status'], { dir })).stdout).nodeId, state.nodeId);
  const models = await invoke(['--json', 'models'], { dir }); assert.deepEqual(JSON.parse(models.stdout).models, []);
  const failed = await invoke(['run', 'hello'], { dir }); assert.equal(failed.code, 1); assert.match(failed.stderr, /model_required/);
});

test('real local HTTP streaming, durable conversation continuation and structured snapshots', async (t) => {
  const dir = directory();
  const provider = await server(t, (request, response) => {
    assert.equal(request.path, '/v1/chat/completions'); assert.equal(request.headers.authorization, `Bearer ${key}`);
    assert.ok(!JSON.stringify(request.body).includes(key));
    completion(response, `answer-${request.body.messages.filter((message) => message.role === 'user').length}`);
  });
  const file = config(dir, provider.base);
  const first = await invoke(['--config', file, '--json', 'run', 'first question'], { dir, env });
  assert.equal(first.code, 0, first.stderr);
  const trace = events(first.stdout); const begun = trace.find((event) => event.eventType === 'run.started');
  assert.ok(begun); assert.equal(trace.at(-1).eventType, 'run.completed');
  const next = await invoke(['--config', file, '--chat', begun.chatId, 'run', 'second question'], { dir, env });
  assert.equal(next.code, 0, next.stderr); assert.match(next.stdout, /answer-2/);
  const history = await invoke(['--json', 'chats', 'show', begun.chatId], { dir });
  assert.equal(JSON.parse(history.stdout).length, 4);
  const receipt = await invoke(['--json', 'runs', 'show', begun.runId], { dir });
  assert.equal(JSON.parse(receipt.stdout).snapshot.model.id, 'test');
  assert.equal(JSON.parse(receipt.stdout).snapshot.workspace, null);
  const raw = readFileSync(join(dir, 'state/state.sqlite'));
  assert.equal(raw.includes(Buffer.from(key)), false);
});

test('provider credentials split across streaming deltas cannot enter stdout or state', async (t) => {
  const dir = directory();
  const provider = await server(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const content of ['before ', key.slice(0, 7), key.slice(7), ' after']) {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`);
    }
    response.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  const file = config(dir, provider.base);
  const result = await invoke(['--config', file, '--json', 'run', 'safe prompt'], { dir, env });
  assert.equal(result.code, 0, result.stderr); assert.ok(!result.stdout.includes(key)); assert.ok(!result.stderr.includes(key));
  const text = events(result.stdout).filter((e) => e.eventType === 'model.delta').map((e) => e.payload.text).join('');
  assert.equal(text, 'before [REDACTED] after');
  assert.ok(!readFileSync(join(dir, 'state/state.sqlite')).includes(Buffer.from(key)));
});

test('a piped local agent can read the granted Workspace but cannot approve an edit', async (t) => {
  const dir = directory(); const cwd = workspace(dir); writeFileSync(join(cwd, 'hello.txt'), 'original\n');
  let step = 0; let seenDenial = false;
  const provider = await server(t, (request, response) => {
    step++;
    if (step === 1) tool(response, 'workspace_enter', {}, 'enter');
    else if (step === 2) tool(response, 'read_file', { path: 'hello.txt' }, 'read');
    else if (step === 3) {
      const read = JSON.parse(request.body.messages.at(-1).content);
      assert.equal(read.content, 'original\n');
      tool(response, 'write_file', { path: 'hello.txt', content: 'changed\n', expectedHash: read.sha256 }, 'write');
    } else {
      seenDenial = JSON.parse(request.body.messages.at(-1).content).type === 'denied';
      completion(response, 'Edit was not approved.');
    }
  });
  const file = config(dir, provider.base);
  const result = await invoke(['--config', file, '--native', '--cwd', cwd, '--json', 'run', 'inspect and edit'], { dir, env });
  assert.equal(result.code, 0, result.stderr); assert.equal(seenDenial, true);
  assert.equal(readFileSync(join(cwd, 'hello.txt'), 'utf8'), 'original\n');
  assert.ok(events(result.stdout).some((e) => e.eventType === 'approval.decided' && e.payload.approved === false));
});

test('unknown tools become correlated observations', async (t) => {
  const dir = directory(); const cwd = workspace(dir); let step = 0;
  const provider = await server(t, (request, response) => {
    if (step++ === 0) tool(response, 'not_installed', { x: 1 }, 'unknown');
    else {
      const observation = request.body.messages.at(-1);
      assert.equal(observation.role, 'tool'); assert.equal(observation.tool_call_id, 'unknown');
      assert.equal(JSON.parse(observation.content).status, 'error'); completion(response, 'No unsupported action occurred.');
    }
  });
  const result = await invoke(['--config', config(dir, provider.base), '--native', '--cwd', cwd, 'run', 'test'], { dir, env });
  assert.equal(result.code, 0, result.stderr);
});

test('step budget ends with a tool-free request, not unbounded tool execution', async (t) => {
  const dir = directory(); const cwd = workspace(dir); let step = 0;
  const provider = await server(t, (request, response) => {
    if (step++ === 0) tool(response, 'workspace_enter', {}, 'enter');
    else { assert.equal(request.body.tools, undefined); completion(response, 'Budget reached.'); }
  });
  const result = await invoke(['--config', config(dir, provider.base, { maxSteps: 1 }), '--native', '--cwd', cwd, '--json', 'run', 'test'], { dir, env });
  assert.equal(result.code, 0, result.stderr); assert.equal(step, 2);
  assert.ok(events(result.stdout).some((e) => e.eventType === 'run.step_cap_reached'));
});

test('premature stream closure fails without executing partial tool arguments or retrying', async (t) => {
  const dir = directory();
  const provider = await server(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' }, finish_reason: null }] })}\n\n`);
  });
  const result = await invoke(['--config', config(dir, provider.base), '--json', 'run', 'test'], { dir, env });
  assert.equal(result.code, 1); assert.equal(provider.requests.length, 1);
  assert.ok(events(result.stdout).some((e) => e.eventType === 'run.failed'));
  assert.match(result.stderr, /incomplete_completion/);
});

test('SIGINT durably cancels local inference and releases its executor lock', async (t) => {
  const dir = directory(); let started;
  const requested = new Promise((resolve) => { started = resolve; });
  const provider = await server(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(': waiting\n\n'); started();
  });
  const running = start(['--config', config(dir, provider.base), '--json', 'run', 'wait'], { dir, env });
  await requested; running.child.kill('SIGINT'); const result = await running.result;
  assert.equal(result.code, 130, result.stderr);
  assert.ok(events(result.stdout).some((e) => e.eventType === 'run.cancelled'));
  assert.equal(existsSync(join(dir, 'state/executor.lock')), false);
});

test('a killed executor needs explicit recovery; it never replays an action', async (t) => {
  const dir = directory(); let started;
  const requested = new Promise((resolve) => { started = resolve; });
  const provider = await server(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(': wait\n\n'); started();
  });
  const file = config(dir, provider.base);
  const running = start(['--config', file, '--json', 'run', 'wait'], { dir, env });
  await requested;
  const competing = await invoke(['--config', file, 'run', 'another'], { dir, env });
  assert.equal(competing.code, 1); assert.match(competing.stderr, /executor_busy/); assert.equal(provider.requests.length, 1);
  running.child.kill('SIGKILL'); await running.result;
  const recovery = await invoke(['recover'], { dir }); assert.equal(recovery.code, 0, recovery.stderr);
  const db = new DatabaseSync(join(dir, 'state/state.sqlite'));
  assert.equal(db.prepare('SELECT status FROM runs').get().status, 'interrupted');
  db.close(); assert.equal(provider.requests.length, 1);
});

test('private config validation is strict and config init refuses overwrite', async () => {
  const dir = directory(); const path = join(dir, 'own.json');
  const first = await invoke(['--config', path, 'config', 'init'], { dir }); assert.equal(first.code, 0, first.stderr);
  assert.equal((await invoke(['--config', path, 'config', 'init'], { dir })).code, 1);
  writeFileSync(path, JSON.stringify({ version: 1, models: [], stealth: true }));
  const bad = await invoke(['--config', path, 'models'], { dir }); assert.equal(bad.code, 1); assert.match(bad.stderr, /unknown_field/);
});


test('an explicitly empty remote or config option cannot silently select another mode', async () => {
  for (const option of ['--remote', '--config']) {
    const result = await invoke([option, '', 'run', 'must not execute']);
    assert.equal(result.code, 1); assert.match(result.stderr, /Option values must not be empty/);
    assert.equal(existsSync(join(result.dir, 'state/state.sqlite')), false);
  }
});

test('malformed tool JSON is recorded as an error instead of being executed', async (t) => {
  const dir = directory(); const cwd = workspace(dir); let step = 0;
  const provider = await server(t, (request, response) => {
    if (step++ === 0) return frames(response, [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'malformed', type: 'function', function: { name: 'process_run', arguments: '{broken' } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, '[DONE]',
    ]);
    const observation = request.body.messages.at(-1);
    assert.equal(observation.role, 'tool'); assert.equal(observation.tool_call_id, 'malformed');
    assert.equal(JSON.parse(observation.content).type, 'invalid_json');
    completion(response, 'Malformed call was rejected.');
  });
  const result = await invoke(['--config', config(dir, provider.base), '--native', '--cwd', cwd, '--json', 'run', 'test'], { dir, env });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(events(result.stdout).filter((event) => event.eventType === 'side_effect.started').length, 0);
});

test('SIGINT interrupts a pipeline waiting for stdin without waiting for EOF', async () => {
  const { setTimeout: delay } = await import('node:timers/promises');
  const dir = directory(); const running = start(['run', '-'], { dir, input: null });
  const deadline = Date.now() + 5000;
  while (!existsSync(join(dir, 'state/state.sqlite')) && Date.now() < deadline) await delay(10);
  assert.ok(existsSync(join(dir, 'state/state.sqlite')));
  running.child.kill('SIGINT');
  const result = await running.result;
  assert.equal(result.code, 130, result.stderr); assert.match(result.stderr, /Input cancelled/);
});
