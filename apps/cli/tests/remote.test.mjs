import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { invoke, server, frames, json, directory, token, userId, chatId, runId, apiSpec } from './helpers.mjs';

async function authenticated(t, handler) {
  const dir = directory();
  const hub = await server(t, (request, response) => {
    if (request.path === '/auth/v1/login') {
      assert.deepEqual(request.body, { email: 'user@example.test', password: 'private-password' });
      return json(response, { token, user: { id: userId }, session: { id: runId } });
    }
    if (request.path === '/auth/v1/me') {
      assert.equal(request.headers.authorization, `Bearer ${token}`); return json(response, { id: userId, email: 'user@example.test' });
    }
    return handler(request, response);
  });
  const login = await invoke(['--remote', hub.base, '--json', 'auth', 'login', '--email', 'user@example.test', '--password-stdin'], { dir, input: 'private-password\n' });
  assert.equal(login.code, 0, login.stderr); assert.ok(!login.stdout.includes(token)); assert.ok(!login.stderr.includes('private-password'));
  return { hub, dir, login };
}

function runEvent(sequence, eventType, payload) { return { sequence, eventType, payload, createdAt: '2026-09-05T00:00:00Z' }; }

test('remote login binds a private credential to the exact authority and does not enroll', async (t) => {
  const { hub, dir, login } = await authenticated(t, (_request, response) => json(response, {}, 404));
  assert.equal(JSON.parse(login.stdout).enrolled, false);
  const files = readdirSync(join(dir, 'state/auth'));
  assert.equal(files.length, 1); const saved = JSON.parse(readFileSync(join(dir, 'state/auth', files[0]), 'utf8'));
  assert.equal(saved.authority, hub.base); assert.equal(saved.userId, userId); assert.equal(saved.token, token);
  assert.equal(statSync(join(dir, 'state/auth', files[0])).mode & 0o777, 0o600);
  assert.equal(existsSync(join(dir, 'state/state.sqlite')), false);
  const other = await server(t, (_request, response) => json(response, {}, 418));
  const denied = await invoke(['--remote', other.base, 'auth', 'status'], { dir });
  assert.equal(denied.code, 1); assert.equal(other.requests.length, 0);
});

test('remote run consumes the existing contract and reconnects by cursor without resubmitting', async (t) => {
  let eventConnections = 0;
  const { hub, dir } = await authenticated(t, (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    if (request.path === '/api/v1/models') return json(response, { defaultModelId: 'remote-model', models: [{ id: 'remote-model' }] });
    if (request.path.endsWith('/messages')) {
      assert.equal(request.method, 'POST'); assert.equal(request.body.modelId, 'remote-model');
      assert.deepEqual(request.body.message.parts, [{ type: 'text', text: 'hello remote' }]);
      assert.deepEqual(Object.keys(request.body).sort(), ['message', 'modelId']);
      return frames(response, [{ type: 'start', messageId: runId }]);
    }
    if (request.path === `/api/v1/runs/${runId}`) return json(response, { id: runId, chatId, status: 'completed' });
    if (request.path.includes('/events')) {
      eventConnections++;
      if (eventConnections === 1) {
        assert.equal(request.headers['last-event-id'], '0');
        return frames(response, [runEvent(1, 'run.started', {}), runEvent(2, 'model.delta', { text: 'Hel' })]);
      }
      if (request.headers['last-event-id'] === '4') return frames(response, ['[DONE]']);
      assert.equal(request.headers['last-event-id'], '2');
      assert.ok(request.path.endsWith('?after_sequence=2'));
      return frames(response, [runEvent(2, 'model.delta', { text: 'Hel' }), runEvent(3, 'model.delta', { text: 'lo' }), runEvent(4, 'run.completed', {}), '[DONE]']);
    }
    json(response, {}, 404);
  });
  const result = await invoke(['--remote', hub.base, '--chat', chatId, 'run', 'hello remote'], { dir });
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, 'Hello\n');
  assert.equal(eventConnections, 2); assert.equal(hub.requests.filter((req) => req.method === 'POST' && req.path.endsWith('/messages')).length, 1);
  const resumed = await invoke(['--remote', hub.base, '--json', 'runs', 'events', runId], { dir });
  // A terminal tail replay is empty and succeeds from the persisted cursor.
  assert.ok(hub.requests.some((req) => req.path.endsWith('?after_sequence=4')));
  assert.equal(resumed.code, 0, resumed.stderr);
});

test('ambiguous message submission is not retried and preserves an inspectable chat ID', async (t) => {
  const { hub, dir } = await authenticated(t, (request, response) => {
    if (request.path === '/api/v1/models') return json(response, { defaultModelId: 'm', models: [{ id: 'm' }] });
    if (request.path.endsWith('/messages')) { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(); return; }
    json(response, {}, 404);
  });
  const result = await invoke(['--remote', hub.base, '--chat', chatId, 'run', 'submit once'], { dir });
  assert.equal(result.code, 1); assert.match(result.stderr, /submission_uncertain/); assert.ok(result.stderr.includes(chatId));
  assert.equal(hub.requests.filter((req) => req.path.endsWith('/messages')).length, 1);
});

test('remote cancellation uses PATCH and logout revokes before removing the saved credential', async (t) => {
  let failLogout = true;
  const { hub, dir } = await authenticated(t, (request, response) => {
    if (request.path === `/api/v1/runs/${runId}`) {
      assert.equal(request.method, 'PATCH'); assert.deepEqual(request.body, { status: 'cancelled' });
      return json(response, { id: runId, chatId, status: 'cancelled' });
    }
    if (request.path === '/auth/v1/sessions/current') {
      assert.equal(request.method, 'DELETE'); return json(response, { revokedCount: 1 }, failLogout ? 503 : 200);
    }
    json(response, {}, 404);
  });
  const cancelled = await invoke(['--remote', hub.base, 'runs', 'cancel', runId], { dir });
  assert.equal(cancelled.code, 0, cancelled.stderr);
  const failed = await invoke(['--remote', hub.base, 'auth', 'logout'], { dir }); assert.equal(failed.code, 1);
  assert.equal(readdirSync(join(dir, 'state/auth')).length, 1);
  failLogout = false;
  const success = await invoke(['--remote', hub.base, 'auth', 'logout'], { dir }); assert.equal(success.code, 0, success.stderr);
  assert.equal(readdirSync(join(dir, 'state/auth')).length, 0);
});

test('remote mode never resolves local config, sends local keys, or offers a Workspace', async (t) => {
  const { hub, dir } = await authenticated(t, (request, response) => {
    if (request.path === '/api/v1/models') return json(response, { defaultModelId: 'm', models: [{ id: 'm' }] });
    json(response, {}, 404);
  });
  const result = await invoke(['--remote', hub.base, 'models'], { dir, env: { LLAME_CONFIG: '/does-not-exist/private.json', TEST_PROVIDER_KEY: 'private-key-never-use' } });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!JSON.stringify(hub.requests).includes('private-key-never-use'));
  const mixed = await invoke(['--remote', hub.base, '--native', 'run', 'read cwd'], { dir });
  assert.equal(mixed.code, 1); assert.match(mixed.stderr, /mode_conflict/);
});

test('redirected authentication cannot forward a password/token to another authority', async (t) => {
  const dir = directory(); const recipient = await server(t, (_request, response) => json(response, {}));
  const hub = await server(t, (_request, response) => { response.writeHead(307, { location: recipient.base + '/collect' }); response.end(); });
  const result = await invoke(['--remote', hub.base, 'auth', 'login', '--email', 'user@example.test', '--password-stdin'], { dir, input: 'private-password' });
  assert.equal(result.code, 1); assert.equal(recipient.requests.length, 0); assert.ok(!result.stderr.includes('private-password'));
});

test('environment sessions require an explicit matching token authority', async (t) => {
  const dir = directory(); const hub = await server(t, (_request, response) => json(response, { id: userId }));
  const denied = await invoke(['--remote', hub.base, 'auth', 'status'], { dir, env: { LLAME_TOKEN: token } });
  assert.equal(denied.code, 1); assert.equal(hub.requests.length, 0);
  const allowed = await invoke(['--remote', hub.base, '--json', 'auth', 'status'], { dir, env: { LLAME_TOKEN: token, LLAME_TOKEN_FOR: hub.base } });
  assert.equal(allowed.code, 0, allowed.stderr); assert.equal(JSON.parse(allowed.stdout).source, 'environment');
  assert.equal(readdirSync(join(dir, 'state/auth')).length, 0);
});

test('the checked-in OpenAPI includes the exact existing paths and request DTOs used by CLI', () => {
  const spec = JSON.parse(readFileSync(apiSpec, 'utf8'));
  for (const [path, method] of [
    ['/auth/v1/login', 'post'], ['/auth/v1/me', 'get'], ['/auth/v1/sessions/current', 'delete'],
    ['/api/v1/models', 'get'], ['/api/v1/chats/{id}/messages', 'post'], ['/api/v1/chats/{id}/stream', 'get'],
    ['/api/v1/runs/{id}', 'patch'], ['/api/v1/runs/{id}/events', 'get'], ['/api/v1/runs/{id}/context-receipt', 'get'],
  ]) assert.ok(spec.paths[path]?.[method], `${method} ${path}`);
  const login = spec.components.schemas.LoginDto;
  assert.deepEqual(login.required.sort(), ['email', 'password']);
  const cancel = spec.components.schemas.UpdateRunDto;
  assert.deepEqual(cancel.properties.status.enum, ['cancelled']);
});

test('logout removes an expired credential without requiring a successful me request', async (t) => {
  const dir = directory(); let expired = false;
  const hub = await server(t, (request, response) => {
    if (request.path === '/auth/v1/login') return json(response, { token });
    if (request.path === '/auth/v1/me') return json(response, { id: userId }, expired ? 401 : 200);
    if (request.path === '/auth/v1/sessions/current') {
      assert.equal(request.method, 'DELETE'); return json(response, {}, 401);
    }
    return json(response, {}, 404);
  });
  const login = await invoke(['--remote', hub.base, 'auth', 'login', '--email', 'user@example.test', '--password-stdin'], { dir, input: 'private-password' });
  assert.equal(login.code, 0, login.stderr);
  const before = hub.requests.filter((entry) => entry.path === '/auth/v1/me').length;
  expired = true;
  const result = await invoke(['--remote', hub.base, 'auth', 'logout'], { dir });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(hub.requests.filter((entry) => entry.path === '/auth/v1/me').length, before);
  assert.equal(readdirSync(join(dir, 'state/auth')).length, 0);
});

test('a saved session cannot silently switch account identity', async (t) => {
  const { hub, dir } = await authenticated(t, (_request, response) => json(response, {}, 404));
  const file = join(dir, 'state/auth', readdirSync(join(dir, 'state/auth'))[0]);
  const credential = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...credential, userId: '44444444-4444-4444-8444-444444444444' }));
  const result = await invoke(['--remote', hub.base, 'models'], { dir });
  assert.equal(result.code, 1); assert.match(result.stderr, /account_changed/);
  assert.equal(hub.requests.filter((entry) => entry.path === '/api/v1/models').length, 0);
});

test('persistent remote exposes owner-scoped chat search and paged Knowledge metadata', async (t) => {
  const query = 'archivo & 日本語 = заметка';
  const cursor = 'opaque_cursor-value=';
  const { hub, dir } = await authenticated(t, (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    const url = new URL(request.path, 'http://fixture');
    if (url.pathname === '/api/v1/chats/search') {
      assert.equal(url.searchParams.get('q'), query);
      assert.equal(url.searchParams.get('limit'), '20');
      assert.equal(url.searchParams.has('userId'), false);
      return json(response, { results: [{ id: chatId, title: 'recuerdo', snippet: 'source text', updatedAt: '2026-09-05T00:00:00Z' }] });
    }
    if (url.pathname === '/api/v1/knowledge-spaces') {
      assert.equal(url.searchParams.get('limit'), '50');
      return json(response, { items: url.searchParams.has('after') ? [] : [{ id: chatId, name: 'Notes' }], nextCursor: url.searchParams.has('after') ? null : cursor });
    }
    if (url.pathname === `/api/v1/knowledge-spaces/${chatId}`) return json(response, { id: chatId, name: 'Notes' });
    json(response, {}, 404);
  });
  assert.equal((await invoke(['remote', 'enable', hub.base], { dir })).code, 0);
  const found = await invoke(['--json', 'chats', 'search', query], { dir });
  assert.equal(found.code, 0, found.stderr); assert.equal(JSON.parse(found.stdout).results[0].id, chatId);
  const page = await invoke(['--json', 'knowledge', 'list'], { dir });
  assert.equal(page.code, 0, page.stderr); assert.equal(JSON.parse(page.stdout).nextCursor, cursor);
  const next = await invoke(['--json', 'knowledge', 'list', cursor], { dir });
  assert.equal(next.code, 0, next.stderr); assert.equal(JSON.parse(next.stdout).nextCursor, null);
  const shown = await invoke(['--json', 'knowledge', 'show', chatId], { dir });
  assert.equal(shown.code, 0, shown.stderr); assert.equal(JSON.parse(shown.stdout).name, 'Notes');
  const local = await invoke(['--local', 'knowledge', 'list'], { dir });
  assert.equal(local.code, 1); assert.match(local.stderr, /remote_required/);
});

test('run tools reports exact historical availability without fabricating or importing remote tools', async (t) => {
  const tools = ['search_conversations', 'conversation_read', 'knowledge_search', 'knowledge_read', 'mcp__fixture__read'].map(id => ({ id, description: 'fixture', inputSchema: { type: 'object' } }));
  const availability = { version: 1, entries: [
    { id: 'search_conversations', state: 'available', declarationHash: '123', label: 'available' },
    { id: 'mcp__offline__read', state: 'unavailable', reason: 'source_disconnected', label: 'source unavailable' },
  ] };
  const { hub, dir } = await authenticated(t, (request, response) => {
    assert.equal(request.path, `/api/v1/runs/${runId}/context-receipt`);
    return json(response, { tools, toolAvailability: availability, availabilityHash: 'receipt-hash', systemPrompt: 'not shown by tools command' });
  });
  const result = await invoke(['--remote', hub.base, '--json', 'runs', 'tools', runId], { dir });
  assert.equal(result.code, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.deepEqual(data.tools, tools); assert.deepEqual(data.toolAvailability, availability);
  assert.equal(data.historical, true); assert.equal(data.systemPrompt, undefined);
  const untrusted = await invoke(['--remote', hub.base, 'runs', 'tools', '../another-owner'], { dir });
  assert.equal(untrusted.code, 1); assert.match(untrusted.stderr, /invalid_/);
  assert.equal(hub.requests.filter(entry => entry.path.includes('context-receipt')).length, 1);
});

test('inspection commands are bound to existing OpenAPI resources, not a fabricated generic tool gateway', () => {
  const spec = JSON.parse(readFileSync(apiSpec, 'utf8'));
  for (const path of ['/api/v1/chats/search', '/api/v1/knowledge-spaces', '/api/v1/knowledge-spaces/{id}', '/api/v1/runs/{id}/context-receipt']) {
    assert.ok(spec.paths[path]?.get, path);
  }
  assert.ok(spec.components.schemas.KnowledgeSpaceCollectionResponse.required.includes('nextCursor'));
  assert.ok(spec.components.schemas.ContextReceiptResponse.required.includes('toolAvailability'));
  const parameters = spec.paths['/api/v1/chats/search'].get.parameters;
  assert.ok(parameters.some(parameter => parameter.name === 'q' && parameter.in === 'query'));
});
