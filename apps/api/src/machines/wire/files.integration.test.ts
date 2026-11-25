import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MACHINE_BINARY } from '../../testing/local-daemon.js';
import { createLocalChildTransportFactory } from '../local-child-transport.js';
import { isRecord, isString } from '@workspace/runtime-safety';

import { MachineSession } from '../machine-session.js';

const NAME = 'files-v3-test';
const ENVELOPE = { budgetMs: 60_000 };
const PREFIX = `machine://${NAME}`;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6fsAAAAASUVORK5CYII=',
  'base64',
);

describe('wire files against the real Machine daemon', () => {
  let configDir: string;
  let stateDir: string;
  let root: string;
  let session: MachineSession;

  beforeAll(() => {
    configDir = mkdtempSync(join(tmpdir(), 'llame-wire-files-config-'));
    stateDir = mkdtempSync(join(tmpdir(), 'llame-wire-files-state-'));
    root = realpathSync(mkdtempSync(join(tmpdir(), 'llame-wire-files-root-')));
    writeFileSync(join(root, 'notes.txt'), 'alpha\nbeta\n');
    writeFileSync(join(root, 'image.png'), PNG);
    execFileSync(MACHINE_BINARY, ['roots', 'add', root], {
      env: {
        ...process.env,
        LLAME_MACHINE_CONFIG_DIR: configDir,
        LLAME_MACHINE_STATE_DIR: stateDir,
      },
      stdio: 'pipe',
    });

    const factory = createLocalChildTransportFactory({
      command: MACHINE_BINARY,
      env: {
        ...process.env,
        LLAME_MACHINE_CONFIG_DIR: configDir,
        LLAME_MACHINE_STATE_DIR: stateDir,
      },
    });

    session = new MachineSession({
      name: NAME,
      transport: factory.open({ name: NAME }),
      hubVersion: '0.0.0-files-test',
    });
  });

  afterAll(() => {
    session?.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('calls stat, list, read, edit, write and bytes through the session', async () => {
    await session.ready();

    await expect(
      session.call('fs.stat', {
        envelope: ENVELOPE,
        path: join(root, 'notes.txt'),
      }),
    ).resolves.toMatchObject({ kind: 'file', isLink: false });

    const listed = await session.call('fs.list', {
      envelope: ENVELOPE,
      path: root,
    });

    expect(
      'entries' in listed &&
        listed.entries.some((entry) => entry.name === 'notes.txt'),
    ).toBe(true);
    expect(
      'entries' in listed &&
        listed.entries.some((entry) => entry.name === 'image.png'),
    ).toBe(true);

    const read = await session.call('fs.read', {
      envelope: ENVELOPE,
      path: join(root, 'notes.txt'),
      options: { displayPrefix: PREFIX },
    });

    expect(read).toMatchObject({
      status: 'success',
      kind: 'file',
      path: `${PREFIX}${join(root, 'notes.txt')}`,
    });

    if (read.status === 'success' && 'content' in read)
      expect(read.content).toContain('2: beta');

    const edited = await session.call('fs.edit', {
      envelope: ENVELOPE,
      path: join(root, 'notes.txt'),
      options: { displayPrefix: PREFIX },
      oldText: 'beta',
      newText: 'gamma',
    });

    expect(edited).toMatchObject({
      status: 'success',
      operation: 'edit',
      display: { startLine: 2, oldText: 'beta', newText: 'gamma' },
    });
    expect(readFileSync(join(root, 'notes.txt'), 'utf8')).toBe(
      'alpha\ngamma\n',
    );

    const written = await session.call('fs.write', {
      envelope: ENVELOPE,
      path: join(root, 'created.txt'),
      options: { displayPrefix: PREFIX },
      content: 'written\n',
    });

    expect(written).toMatchObject({
      status: 'success',
      operation: 'write',
      created: true,
    });
    expect(readFileSync(join(root, 'created.txt'), 'utf8')).toBe('written\n');

    const chunks: Array<Buffer> = [];

    const bytes = await session.call(
      'fs.bytes',
      { envelope: ENVELOPE, path: join(root, 'image.png') },
      {
        onNotification: (notification) => {
          if (
            notification.method !== 'bytes' ||
            !isRecord(notification.params) ||
            !isString(notification.params['data'])
          )
            return;

          chunks.push(Buffer.from(notification.params['data'], 'base64'));
        },
      },
    );

    expect(bytes).toEqual({ size: PNG.byteLength, mediaType: 'image/png' });
    expect(Buffer.concat(chunks)).toEqual(PNG);
  });
});
