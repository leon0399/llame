import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

export const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../bin/llame.cjs');
export const apiSpec = resolve(dirname(cli), '../../api/openapi.json');
export const key = 'sk-test-long-private-provider-value-123456789';
export const token = 'llame-session-private-value-abcdefghijklmnopqrstuvwxyz';
export const userId = '11111111-1111-4111-8111-111111111111';
export const runId = '22222222-2222-4222-8222-222222222222';
export const chatId = '33333333-3333-4333-8333-333333333333';

export function directory() { return mkdtempSync(join(tmpdir(), 'llame-cli-test-')); }

export function start(args, { dir = directory(), env = {}, input = '', timeout = 15000 } = {}) {
  const child = spawn(process.execPath, [cli, '--data-dir', join(dir, 'state'), ...args], {
    env: { PATH: process.env.PATH, HOME: dir, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end(input);
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const result = new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`CLI timeout: ${stderr}`)); }, timeout);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolveResult({ code, signal, stdout, stderr, dir }); });
  });
  return { child, result, stdout: () => stdout, stderr: () => stderr };
}
export async function invoke(args, options) { return start(args, options).result; }

export async function server(t, handler) {
  const requests = [];
  const http = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const data of req) chunks.push(data);
      const body = Buffer.concat(chunks).toString();
      const entry = { path: req.url, method: req.method, headers: req.headers, body: body ? JSON.parse(body) : undefined };
      requests.push(entry); await handler(entry, res, req);
    } catch (error) { res.writeHead(500); res.end(); }
  });
  await new Promise((done) => http.listen(0, '127.0.0.1', done));
  t.after(() => { http.closeAllConnections(); return new Promise((done) => http.close(done)); });
  return { base: `http://127.0.0.1:${http.address().port}`, requests, http };
}

export function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
}
export function frames(res, values) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const value of values) res.write(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`);
  res.end();
}
export function completion(res, content) {
  frames(res, [{ choices: [{ index: 0, delta: { content }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }, '[DONE]']);
}
export function tool(res, name, args, id = 'call-1') {
  frames(res, [{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }, '[DONE]']);
}
export function config(dir, base, overrides = {}) {
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify({ version: 1, defaultModel: 'test', models: [
    { id: 'test', model: 'fixture-model', baseUrl: `${base}/v1`, apiKey: '{env:TEST_PROVIDER_KEY}' },
  ], maxContextBytes: 200_000, ...overrides }), { mode: 0o600 });
  return path;
}
export function workspace(dir) { const path = join(dir, 'workspace'); mkdirSync(path); return path; }
export function events(stdout) { return stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
