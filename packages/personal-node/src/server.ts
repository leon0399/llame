import { createServer, type Socket } from 'node:net';
import { chmodSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { environment, defaultPaths } from './env';
import { CliError } from './errors';
import { NodeService, type NodeBoot } from './node-service';
import { NodeSession } from './node-session';
import { claimServer, socketPath, entryExists } from './socket';

export async function serveNode(boot: NodeBoot): Promise<void> {
  process.umask(0o077);
  if (boot.transport === 'unix') { await serveSocket(boot); return; }
  const service = new NodeService(boot);
  const session = new NodeSession(service, process.stdin, process.stdout, false);
  const stop = () => { session.close(true); process.stdin.destroy(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  await new Promise<void>(done => {
    process.stdin.once('end', done); process.stdin.once('close', done);
  });
  session.close(true); await session.settled(); await service.stop();
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
}

async function serveSocket(boot: NodeBoot): Promise<void> {
  const path = socketPath(boot.data);
  const release = claimServer(boot.data);
  let service: NodeService | undefined;
  let owned: { ino: number; dev: number } | undefined;
  const sessions = new Set<NodeSession>();
  const sockets = new Set<Socket>();
  try {
    if (entryExists(path)) throw new CliError('node_socket_exists', 'An endpoint already exists. It was not replaced.');
    const node = new NodeService(boot); service = node;
    const server = createServer(socket => {
      if (sockets.size >= 16) { socket.destroy(); return; }
      sockets.add(socket);
      const session = new NodeSession(node, socket, socket, true); sessions.add(session);
      socket.once('close', () => {
        sockets.delete(socket); session.close();
        void session.settled().finally(() => sessions.delete(session));
      });
    });
    await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(path, () => { server.off('error', reject); done(); }); });
    chmodSync(path, 0o600); const stat = lstatSync(path); owned = { ino: stat.ino, dev: stat.dev };
    process.stderr.write('Local Node ready on its private Unix socket. No TCP listener or account is required.\n');
    await new Promise<void>(done => {
      const stop = () => {
        process.off('SIGINT', stop); process.off('SIGTERM', stop); done();
      };
      process.once('SIGINT', stop); process.once('SIGTERM', stop); server.once('error', stop);
    });
    server.close();
    for (const session of sessions) session.close(true);
    for (const socket of sockets) socket.destroy();
    await Promise.allSettled([...sessions].map(session => session.settled()));
  } finally {
    await service?.stop();
    if (owned && existsSync(path)) {
      const stat = lstatSync(path);
      if (stat.ino === owned.ino && stat.dev === owned.dev) unlinkSync(path);
    }
    release();
  }
}

async function main(): Promise<void> {
  const env = environment(); const defaults = defaultPaths(env);
  const { values } = parseArgs({ strict: true, options: { config: { type: 'string' }, 'data-dir': { type: 'string' },
    cwd: { type: 'string' }, native: { type: 'boolean' }, stdio: { type: 'boolean' } } });
  await serveNode({ config: resolve(values.config ?? defaults.config), data: resolve(values['data-dir'] ?? defaults.data),
    cwd: resolve(values.cwd ?? process.cwd()), native: values.native === true, transport: values.stdio ? 'stdio' : 'unix', env });
}

if (require.main === module) void main().catch((error: unknown) => {
  const failure = error instanceof CliError ? error : new CliError('node_start_failed', 'Local Node could not start. No action was retried.');
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'core.error', params: { code: failure.code, message: failure.message } }) + '\n');
  process.exitCode = failure.exitCode;
});
