import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, unlinkSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDocument, configureRemote, remoteConfiguration } from '@workspace/personal-node/config';
import { defaultPaths } from '@workspace/personal-node/env';
import { privateDirectory, readPrivate, writePrivate } from '@workspace/personal-node/private-files';
import { directory, invoke, server, json, token, userId, config } from './helpers.mjs';

const routing = (dir) => join(dir, '.config/llame/cli.json');

test('remote enable survives fresh processes, preserves secrets as references, and local overrides once', async (t) => {
  const dir = directory();
  const hub = await server(t, (request, response) => {
    if (request.path === '/auth/v1/login') return json(response, { token });
    if (request.path === '/auth/v1/me') return json(response, { id: userId });
    if (request.path === '/api/v1/models') return json(response, { models: [{ id: 'node' }] });
    json(response, {}, 404);
  });
  mkdirSync(join(dir, '.config/llame'), { recursive: true, mode: 0o700 });
  writePrivate(routing(dir), JSON.stringify({ version: 1, models: [{ id: 'local', model: 'local', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '{env:UNRESOLVED_LOCAL_KEY}' }] }));
  const enabled = await invoke(['remote', 'enable', hub.base], { dir });
  assert.equal(enabled.code, 0, enabled.stderr);
  assert.equal(hub.requests.length, 0, 'configuration must not perform login or inference');
  const saved = JSON.parse(readFileSync(routing(dir), 'utf8'));
  assert.deepEqual(saved.remote, { enabled: true, url: hub.base });
  assert.equal(saved.models[0].apiKey, '{env:UNRESOLVED_LOCAL_KEY}');
  const status = await invoke(['--json', 'status'], { dir });
  assert.equal(status.code, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).mode, 'remote');
  assert.equal(JSON.parse(status.stdout).modeSource, 'config');
  const local = await invoke(['--local', '--json', 'status'], { dir });
  assert.equal(JSON.parse(local.stdout).mode, 'local');
  assert.equal(JSON.parse(local.stdout).modeSource, 'flag');
  const login = await invoke(['auth', 'login', '--email', 'user@example.test', '--password-stdin'], { dir, input: 'private-password' });
  assert.equal(login.code, 0, login.stderr);
  const models = await invoke(['models'], { dir });
  assert.equal(models.code, 0, models.stderr);
  assert.ok(!readFileSync(routing(dir), 'utf8').includes(token));
  const files = readdirSync(join(dir, 'state/auth'));
  assert.equal(files.length, 1);
  assert.equal(statSync(join(dir, 'state/auth', files[0])).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, 'state/auth')).mode & 0o777, 0o700);
  const disabled = await invoke(['remote', 'disable'], { dir });
  assert.equal(disabled.code, 0, disabled.stderr);
  assert.equal(readdirSync(join(dir, 'state/auth')).length, 1);
  assert.equal(JSON.parse((await invoke(['--json', 'status'], { dir })).stdout).mode, 'local');
  assert.equal((await invoke(['remote', 'enable'], { dir })).code, 0);
  assert.equal((await invoke(['auth', 'status'], { dir })).code, 0);
});

test('explicit remote overrides configured authority without changing config or forwarding its session', async (t) => {
  const dir = directory();
  configureRemote(routing(dir), true, 'https://configured.example');
  const other = await server(t, (_request, response) => json(response, { id: userId }));
  const result = await invoke(['--remote', other.base, '--json', 'status'], { dir });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).remote, other.base);
  assert.equal(remoteConfiguration(configDocument(routing(dir))).url, 'https://configured.example');
  const denied = await invoke(['--remote', other.base, 'auth', 'status'], { dir });
  assert.equal(denied.code, 1); assert.equal(other.requests.length, 0);
});

test('enabled remote with missing/expired auth fails closed and never falls back to a local model', async (t) => {
  const dir = directory(); const provider = await server(t, (_request, response) => json(response, {}));
  const path = config(dir, provider.base, { remote: { enabled: true, url: 'https://remote.example' } });
  const result = await invoke(['--config', path, 'run', 'hello'], { dir });
  assert.equal(result.code, 1); assert.match(result.stderr, /login_required/);
  assert.equal(provider.requests.length, 0);
  assert.equal((await invoke(['--config', path, '--native', 'run', 'hello'], { dir })).code, 1);
});

test('persistent mode validates booleans and authority, allows config selection remotely, and keeps help usable', async () => {
  const dir = directory(); const path = join(dir, 'settings.json');
  writePrivate(path, JSON.stringify({ version: 1, models: [], remote: { enabled: 'true', url: 'https://node.example' } }));
  const invalid = await invoke(['--config', path, 'status'], { dir });
  assert.equal(invalid.code, 1); assert.match(invalid.stderr, /invalid_remote/);
  assert.equal((await invoke(['--config', path, '--help'], { dir })).code, 0);
  assert.equal((await invoke(['--config', path, '--remote', 'https://override.example', 'status'], { dir })).code, 0);
  for (const url of ['http://external.example', 'https://user:pass@node.example', 'https://node.example?token=secret']) {
    const bad = await invoke(['remote', 'enable', url], { dir });
    assert.equal(bad.code, 1);
  }
  assert.equal(existsSync(routing(dir)), false);
});

test('configuration updates are exclusive, private, and cannot silently clobber another writer', () => {
  const dir = directory(); const path = join(dir, 'cli.json');
  configureRemote(path, true, 'https://node.example');
  writeFileSync(`${path}.lock`, '{"pid":123}', { mode: 0o600 });
  assert.throws(() => configureRemote(path, false), /locked/);
  assert.equal(remoteConfiguration(configDocument(path)).enabled, true);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('XDG auth/data and configuration locations are distinct and relative XDG roots are ignored', () => {
  assert.deepEqual(defaultPaths({ XDG_CONFIG_HOME: '/private/config', XDG_DATA_HOME: '/private/data' }), {
    config: '/private/config/llame/cli.json', data: '/private/data/llame',
  });
  assert.ok(defaultPaths({}).data.endsWith('/.local/share/llame'));
  assert.deepEqual(defaultPaths({ XDG_CONFIG_HOME: 'relative', XDG_DATA_HOME: 'relative' }), defaultPaths({}));
});

test('credential readers reject loose permissions, hardlinks and symlinked parents without creating through them', async (t) => {
  const dir = directory(); const privateFile = join(dir, 'credential.json');
  writePrivate(privateFile, '{}'); chmodSync(privateFile, 0o640);
  assert.throws(() => readPrivate(privateFile), /0600/);
  chmodSync(privateFile, 0o700); assert.throws(() => readPrivate(privateFile), /0600/);
  chmodSync(privateFile, 0o600);
  const alias = join(dir, 'credential-alias'); linkSync(privateFile, alias);
  assert.throws(() => readPrivate(privateFile), /one link/); unlinkSync(alias);
  const real = join(dir, 'real'); mkdirSync(real, { mode: 0o700 });
  const link = join(dir, 'linked'); symlinkSync(real, link);
  assert.throws(() => privateDirectory(join(link, 'new')), /symbolic/);
  assert.equal(existsSync(join(real, 'new')), false);
  assert.throws(() => writePrivate(join(link, 'secret'), 'token'), /symbolic/);
  const hub = await server(t, (_request, response) => json(response, { id: userId }));
  const login = await invoke(['--remote', hub.base, 'auth', 'import', '--token-stdin'], { dir, input: token });
  assert.equal(login.code, 0, login.stderr);
  const authFile = join(dir, 'state/auth', readdirSync(join(dir, 'state/auth'))[0]);
  chmodSync(authFile, 0o644);
  const before = hub.requests.length;
  const refused = await invoke(['--remote', hub.base, 'auth', 'status'], { dir });
  assert.equal(refused.code, 1); assert.match(refused.stderr, /unsafe_permissions/);
  assert.equal(hub.requests.length, before);
});
