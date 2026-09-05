import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { cli, directory, server, json, token, userId } from './helpers.mjs';

// util-linux script allocates a real PTY. Initial echo is explicitly enabled so
// this checks the application's raw-mode ordering, not a pre-muted test harness.
test('interactive login disables terminal echo before publishing the password prompt', async (t) => {
  const dir = directory(); const password = 'Secrét-PTY-password';
  const hub = await server(t, (request, response) => {
    if (request.path === '/auth/v1/login') {
      assert.equal(request.body.password, password); return json(response, { token });
    }
    if (request.path === '/auth/v1/me') return json(response, { id: userId });
    return json(response, {}, 404);
  });
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const command = [process.execPath, cli, '--data-dir', join(dir, 'state'), '--remote', hub.base,
    'auth', 'login', '--email', 'user@example.test'].map(quote).join(' ');
  const child = spawn('script', ['--quiet', '--return', '--echo', 'always', '--command', command, '/dev/null'], {
    env: { PATH: process.env.PATH, HOME: dir, TERM: 'xterm' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = ''; let sent = false;
  const collect = (chunk) => {
    output += chunk.toString();
    if (!sent && output.includes('Password: ')) {
      sent = true;
      // Send immediately, without sleeps that would mask the prompt/echo race.
      child.stdin.write(password + '\n');
    }
  };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('PTY login did not finish.')); }, 10000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(sent, true); assert.equal(result, 0, output);
  assert.equal(output.includes(password), false, 'Password was echoed to the terminal.');
  assert.equal(output.includes(token), false, 'Session token was printed.');
  assert.equal(hub.requests.filter((request) => request.path === '/auth/v1/login').length, 1);
});
