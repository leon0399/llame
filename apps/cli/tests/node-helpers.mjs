import { connect } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { start } from './helpers.mjs';

export const identity = path => createHash('sha256').update(resolve(path)).digest('hex');
export async function until(check, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await delay(10); }
  throw new Error('Timed out waiting for observable test condition');
}
export async function persistent(t, { dir, config, cwd, native = false, env = {} }) {
  const proc = start(['--config', config, ...(native ? ['--native', '--cwd', cwd] : []), 'node', 'serve'], { dir, env, timeout: 20000 });
  t.after(async () => { proc.child.kill('SIGTERM'); await proc.result; });
  await until(() => proc.stderr().includes('Local Node ready'));
  return proc;
}
export class Rpc {
  constructor(socket) {
    this.socket = socket; this.pending = new Map(); this.notifications = []; this.buffer = ''; this.closed = false;
    socket.on('data', data => {
      this.buffer += data.toString(); let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const frame = JSON.parse(this.buffer.slice(0, end)); this.buffer = this.buffer.slice(end + 1);
        if (frame.method) this.notifications.push(frame);
        else {
          const promise = this.pending.get(frame.id); if (!promise) continue;
          this.pending.delete(frame.id);
          if (frame.error) promise.reject(Object.assign(new Error(frame.error.message), { code: frame.error.data.code }));
          else promise.resolve(frame.result);
        }
      }
    });
    socket.on('error', () => this.fail()); socket.on('close', () => this.fail());
  }
  fail() {
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(Object.assign(new Error('RPC disconnected'), { code: 'disconnected' }));
    this.pending.clear();
  }
  static async open(dir, negotiate = true) {
    const socket = connect(join(dir, 'state/node.sock')); const rpc = new Rpc(socket);
    await new Promise((done, reject) => { socket.once('connect', done); socket.once('error', reject); });
    if (negotiate) rpc.hello = await rpc.call('core.hello', { version: 2 });
    return rpc;
  }
  call(method, params = {}, id = randomUUID()) {
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error('RPC already closed')); return; }
      this.pending.set(id, { resolve, reject }); this.socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  notification(method) { return until(() => this.notifications.find(frame => frame.method === method)); }
  close() { this.socket.destroy(); this.fail(); }
}
