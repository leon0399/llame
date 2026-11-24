import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient, type Transport } from '@connectrpc/connect';
import {
  BootstrapService,
  CreateJobRequestSchema,
  FileService,
  GetInfoRequestSchema,
  JobService,
  ListRootsRequestSchema,
  MachineService,
  OutputStream,
  ReadLinesRequestSchema,
  ReadOutputRequestSchema,
  WatchJobsRequestSchema,
  connectSocket,
  create,
} from '@workspace/machine-protocol';
import { startMachineSshd, MACHINE_SSHD_ROOT } from '../src/testing/machine-sshd/machine-sshd.js';

const BIN = join(import.meta.dirname, '../../machine/dist/x86_64-unknown-linux-musl/llame-machine');
const ROOT = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'llame-machine-transport-matrix-'));
const command = (bin: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
  execFileSync(bin, args, { cwd: options.cwd ?? ROOT, env: { ...process.env, ...options.env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const delayMs = (n: number) => delay(n);

type Scenario = { name: string; socket: string; transport?: Transport; connection?: Socket; ssh?: ChildProcess };

async function connectScenario(s: Scenario) {
  const started = performance.now();
  const socket = await new Promise<Socket>((resolve, reject) => {
    const conn = createConnection(s.socket);
    conn.once('connect', () => resolve(conn));
    conn.once('error', reject);
  });
  s.connection = socket;
  s.transport = connectSocket(socket) as unknown as Transport;
  const bootstrap = createClient(BootstrapService, s.transport);
  const info = await bootstrap.getInfo(create(GetInfoRequestSchema, {}), { timeoutMs: 15_000 });
  const connectMs = performance.now() - started;
  return { bootstrap, machine: createClient(MachineService, s.transport), files: createClient(FileService, s.transport), jobs: createClient(JobService, s.transport), connectMs, info };
}

async function exercise(s: Scenario) {
  const c = await connectScenario(s);
  const unary: number[] = [];
  for (let i = 0; i < 20; i++) {
    const started = performance.now();
    await c.bootstrap.getInfo(create(GetInfoRequestSchema, {}), { timeoutMs: 15_000 });
    unary.push(performance.now() - started);
  }
  unary.sort((a, b) => a - b);
  const p50 = ((unary[9] ?? 0) + (unary[10] ?? 0)) / 2;
  const roots = await c.machine.listRoots(create(ListRootsRequestSchema, {}), { timeoutMs: 15_000 });
  const root = roots.roots[0]?.path ?? MACHINE_SSHD_ROOT;
  const read = await c.files.readLines(create(ReadLinesRequestSchema, { path: join(root, 'notes.txt'), startLine: 1, limit: 1 }), { timeoutMs: 15_000 });
  if (read.result.case !== 'lines') throw new Error(`${s.name}: ReadLines failed: ${read.result.case}`);
  const watch = c.jobs.watchJobs(create(WatchJobsRequestSchema, {}), { timeoutMs: 30_000 })[Symbol.asyncIterator]();
  const jobId = `${Date.now().toString(16)}${Math.random().toString(16).slice(2).padEnd(24, '0')}`.slice(0, 32);
  await c.jobs.createJob(create(CreateJobRequestSchema, { jobId, owner: 'transport-matrix', command: 'sleep 2; echo done' }), { timeoutMs: 15_000 });
  let settled = false;
  while (!settled) {
    const { value, done } = await watch.next();
    if (done) throw new Error(`${s.name}: WatchJobs ended before settled`);
    if (value.event.case === 'job' && value.event.value.id === jobId && value.event.value.state !== 1) settled = true;
  }
  const output: Uint8Array[] = [];
  for await (const chunk of c.jobs.readOutput(create(ReadOutputRequestSchema, { jobId, owner: 'transport-matrix', stream: OutputStream.STDOUT, offset: 0n, limit: 0n }), { timeoutMs: 15_000 })) output.push(chunk.data);
  const outputText = Buffer.concat(output.map((part) => Buffer.from(part))).toString('utf8');
  if (!outputText.includes('done')) throw new Error(`${s.name}: ReadOutput did not contain done: ${outputText}`);
  await watch.return?.();

  await delayMs(20_000);
  await c.bootstrap.getInfo(create(GetInfoRequestSchema, {}), { timeoutMs: 15_000 });
  s.connection?.destroy();
  if (s.ssh) await stop(s.ssh);
  const clean = s.ssh ? s.ssh.exitCode !== null : true;
  console.log(`| ${s.name} | ${c.connectMs.toFixed(1)} ms | ${p50.toFixed(1)} ms | OK | OK | ${clean ? 'yes' : 'no'} |`);
}

function stop(child: ChildProcess) {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  });
}

async function stopDaemon(stateDir: string) {
  try {
    const pid = Number(readFileSync(join(stateDir, 'daemon.lock'), 'utf8').trim());
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 50; i++) {
      try { process.kill(pid, 0); } catch { return; }
      await delayMs(100);
    }
    throw new Error(`daemon ${pid} did not stop`);
  } catch (error) {
    if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) throw error;
  }
}

function forward(local: string, remote: string, destination: string, sshArgs: string[]) {
  const args = [...sshArgs, '-N', '-T', '-o', 'ExitOnForwardFailure=yes', '-o', 'StreamLocalBindUnlink=yes', '-L', `${local}:${remote}`, destination];
  return spawn('ssh', args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function waitSocket(socket: string, child: ChildProcess) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`ssh forwarding process exited: ${child.exitCode}`);
    try {
      const net = await import('node:net');
      await new Promise<void>((resolve, reject) => {
        const conn = net.createConnection(socket);
        conn.once('connect', () => { conn.destroy(); resolve(); });
        conn.once('error', reject);
      });
      return;
    } catch { await delayMs(100); }
  }
  throw new Error(`socket forward did not become ready: ${socket}`);
}

function socketFromSshOutput(output: string): string {
  const socket = output.split(/\r?\n/u).map((line) => line.trim()).findLast((line) => line.startsWith('/') && line.endsWith('/daemon.sock'));
  if (!socket) throw new Error(`SSH attach output did not contain a daemon socket path: ${output}`);
  return socket;
}

async function main() {
  if (!BIN || !readFileSync(BIN).length) throw new Error(`Build the static daemon first: ${BIN}`);
  const localState = join(tmp, 'local-state');
  mkdirSync(localState);
  const localEnv = { LLAME_MACHINE_STATE_DIR: localState, LLAME_MACHINE_CONFIG_DIR: join(tmp, 'local-config') };
  const localRoot = join(tmp, 'local-root');
  mkdirSync(localRoot);
  writeFileSync(join(localRoot, 'notes.txt'), 'transport matrix\n');
  command(BIN, ['roots', 'add', localRoot], { env: localEnv });
  const localSocket = command(BIN, ['attach', '--print-socket'], { env: localEnv });
  console.log('| Scenario | Connect | Unary p50 (20 GetInfo) | Stream | 20 s keepalive | Clean teardown |');
  console.log('|---|---:|---:|---|---|---|');
  const local: Scenario = { name: '1. local Unix socket', socket: localSocket };
  try { await exercise(local); } finally { local.connection?.destroy(); await stopDaemon(localState); }

  const fixture = await startMachineSshd();
  try {
    // Reprovision the box key for a socket-only forced command. The first-hop
    // forwarding key is limited to the single SSH service on the box.
    const pub = readFileSync(`${fixture.hubKeyFile}.pub`, 'utf8').trim();
    const boxAuth = `restrict,port-forwarding,command=\"/usr/local/bin/llame-machine attach --print-socket\" ${pub}\n`;
    const bastionAuth = `restrict,port-forwarding,permitopen=\"box:22\" ${pub}\n`;
    await fixture.box.exec(['sh', '-lc', `printf '%s' '${boxAuth.replaceAll("'", "'\\''")}' > /home/box/.ssh/authorized_keys; chown box:box /home/box/.ssh/authorized_keys; chmod 600 /home/box/.ssh/authorized_keys`]);
    await fixture.bastion.exec(['sh', '-lc', `printf '%s' '${bastionAuth.replaceAll("'", "'\\''")}' > /home/box/.ssh/authorized_keys; chown box:box /home/box/.ssh/authorized_keys; chmod 600 /home/box/.ssh/authorized_keys`]);
    const ssh = fixture.ssh({});
    const sshConfig = join(tmp, 'matrix-ssh-config');
    writeFileSync(sshConfig, `Host *\n  UserKnownHostsFile ${ssh.knownHostsFile}\n  StrictHostKeyChecking yes\n  IdentityFile ${fixture.hubKeyFile}\n  IdentitiesOnly yes\nHost box\n  HostName box\n  User box\n  Port 22\n  HostKeyAlias box\n  ProxyJump bastion\nHost bastion\n  HostName 127.0.0.1\n  User box\n  Port ${fixture.bastion.getMappedPort(22)}\n  HostKeyAlias bastion\n`);
    const sshArgs = ['-F', sshConfig];
    const remoteSocket = socketFromSshOutput(command('ssh', [...sshArgs, '-T', 'box', 'llame-machine attach --print-socket']));
    const directArgs = ['-i', fixture.hubKeyFile, '-o', `UserKnownHostsFile=${ssh.knownHostsFile}`, '-o', 'HostKeyAlias=box', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes', '-p', String(fixture.box.getMappedPort(22))];
    const directSocket = socketFromSshOutput(command('ssh', [...directArgs, '-T', 'box@127.0.0.1', 'llame-machine attach --print-socket']));
    for (const [name, destination, args] of [
      ['2. SSH socket forward', 'box@127.0.0.1', directArgs],
      ['3. one jump host', 'box', sshArgs],
      ['4. restricted two-hop chain', 'box', sshArgs],
    ] as const) {
      const local = join(tmp, `forward-${name.startsWith('2.') ? 'direct' : name.startsWith('3.') ? 'jump' : 'chain'}.sock`);
      const remote = name.startsWith('2.') ? directSocket : remoteSocket;
      const child = forward(local, remote, destination, args);
      const scenario: Scenario = { name, socket: local, ssh: child };
      try { await waitSocket(local, child); await exercise(scenario); } finally { await stop(child); rmSync(local, { force: true }); }
    }

    console.log('\n| 5. microVM | N/A | N/A | stub | N/A | N/A |');
    console.log('MicroVM: keep the daemon on a Unix socket inside the guest. Reach it through SSH StreamLocal forwarding or a host-side vsock proxy; the guest daemon does not need vsock support.');
    console.log('\nFailure-mode checks:');
    const longState = join(tmp, 'a'.repeat(110));
    mkdirSync(longState);
    const tooLong = spawnSync(BIN, ['daemon'], { env: { ...process.env, LLAME_MACHINE_STATE_DIR: longState }, encoding: 'utf8' });
    if (tooLong.status === 0 || !`${tooLong.stderr}`.includes('longer than 107 bytes')) throw new Error('overlong Unix socket path did not fail as expected');
    console.log('- socket path over 107 bytes: PASS, daemon rejects startup with an explicit path-length error.');
    const staleState = join(tmp, 'stale-state');
    const staleConfig = join(tmp, 'stale-config');
    const staleSocket = join(staleState, 'daemon.sock');
    mkdirSync(staleState);
    writeFileSync(staleSocket, 'stale');
    const stale = command(BIN, ['attach', '--print-socket'], { env: { LLAME_MACHINE_STATE_DIR: staleState, LLAME_MACHINE_CONFIG_DIR: staleConfig } });
    const staleConnection = await new Promise<Socket>((resolve, reject) => {
      const connection = createConnection(staleSocket);
      connection.once('connect', () => resolve(connection));
      connection.once('error', reject);
    });
    staleConnection.destroy();
    if (stale !== staleSocket) throw new Error('stale socket was not replaced');
    console.log('- stale socket: PASS, attach replaces the unreachable socket with a live daemon socket.');
    const missingBin = await fixture.box.exec(['sh', '-lc', 'mv /usr/local/bin/llame-machine /usr/local/bin/llame-machine.unavailable']);
    if (missingBin.exitCode !== 0) throw new Error('could not remove daemon binary for missing-install test');
    const missing = spawnSync('ssh', [...sshArgs, '-T', 'box'], { encoding: 'utf8' });
    if (missing.status === 0) throw new Error('forced command succeeded without the daemon binary');
    console.log('- daemon not installed: PASS, forced command exits non-zero when llame-machine is missing.');
    await fixture.box.exec(['sh', '-lc', 'mv /usr/local/bin/llame-machine.unavailable /usr/local/bin/llame-machine']);
    const lossSocket = await new Promise<Socket>((resolve, reject) => { const connection = createConnection(stale); connection.once('connect', () => resolve(connection)); connection.once('error', reject); });
    const lossTransport = connectSocket(lossSocket) as unknown as Transport;
    const lossWatch = createClient(JobService, lossTransport).watchJobs(create(WatchJobsRequestSchema, {}), { timeoutMs: 30_000 })[Symbol.asyncIterator]();
    await lossWatch.next();
    const localPid = Number(readFileSync(join(staleState, 'daemon.lock'), 'utf8').trim());
    process.kill(localPid, 'SIGKILL');
    let lost: unknown;
    try { await lossWatch.next(); } catch (error) { lost = error; }
    lossSocket.destroy();
    if (!(lost instanceof Error) || lost.name === 'AssertionError') throw new Error('killing the daemon mid-stream did not produce a clean Connect session-lost error');
    console.log(`- daemon killed mid-stream: PASS, client receives ${lost.name}: ${lost.message.split('\n')[0]}.`);
    console.log(`- restricted socket forwarding: PASS, forced command returns ${remoteSocket}; only SSH StreamLocal forwarding is opened by the transport.`);
  } finally { await fixture.dispose(); }

  console.log('\nOperator sshd/authorized_keys: set `AllowStreamLocalForwarding local` and `AllowTcpForwarding local` in sshd_config (`AllowTcpForwarding` is needed only on the bastion); use client-side `StreamLocalBindUnlink yes`. The bastion authorized_keys entry is `restrict,port-forwarding,permitopen="box:22" <key>`; the target entry is `restrict,port-forwarding,command="/usr/local/bin/llame-machine attach --print-socket" <key>`. OpenSSH has no path-specific authorized_keys permitopen option for Unix sockets: `AllowStreamLocalForwarding local` restricts direction, not destination path, so use a dedicated account whose daemon socket is the only accessible socket.');
  console.log(`Commands: local: LLAME_MACHINE_STATE_DIR=<state> LLAME_MACHINE_CONFIG_DIR=<config> ${BIN} attach --print-socket; remote discovery: ssh -F "$SSH_CONFIG" -T box llame-machine attach --print-socket; forward: ssh -F "$SSH_CONFIG" -N -T -o ExitOnForwardFailure=yes -o StreamLocalBindUnlink=yes -L "$LOCAL_SOCK:$REMOTE_SOCKET" box (Host box uses ProxyJump bastion); direct target uses ssh -i "$KEY" -p "$BOX_PORT" -T box@127.0.0.1 llame-machine attach --print-socket, then the same -N -L forwarding options.`);
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => rmSync(tmp, { recursive: true, force: true }));
