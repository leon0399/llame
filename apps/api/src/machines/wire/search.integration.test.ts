import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MACHINE_BINARY } from '../../testing/local-daemon';
import { isRecord, isString } from '@workspace/runtime-safety';

import { createLocalChildTransportFactory } from '../local-child-transport';
import { MachineSession } from '../machine-session.js';
import type { FsGrepParams } from '@workspace/machine-protocol';

const HUB_VERSION = '0.0.0-wire-search-test';
const NAME = 'search-machine';
const ENVELOPE = { budgetMs: 60_000 };

describe('wire fs.grep with the real daemon', () => {
  let configDir: string;
  let stateDir: string;
  let root: string;
  let session: MachineSession;

  beforeAll(() => {
    configDir = mkdtempSync(join(tmpdir(), 'llame-search-config-'));
    stateDir = mkdtempSync(join(tmpdir(), 'llame-search-state-'));
    root = realpathSync(mkdtempSync(join(tmpdir(), 'llame-search-root-')));
    writeFileSync(join(root, 'a.txt'), `needle ${'a'.repeat(300)}\n`);
    writeFileSync(join(root, 'b.txt'), 'needle second\n');
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
      hubVersion: HUB_VERSION,
    });
  });

  afterAll(() => {
    session.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('serves consecutive hub-minted pages across SearchFiles streams', async () => {
    await session.ready();

    const params: FsGrepParams = {
      envelope: ENVELOPE,
      path: root,
      globSuffix: '**',
      patterns: ['needle'],
      literal: true,
      ignoreCase: false,
      bounds: {
        files: null,
        entries: null,
        bytes: null,
        fileBytes: null,
        deadlineMs: 60_000,
        limit: 100,
        pageUnits: 180,
        progressed: false,
      },
    };

    const first = await session.call('fs.grep', params);

    if (!isRecord(first) || first['ok'] !== true || !isString(first['cursor']))
      throw new Error(
        `First grep page did not continue: ${JSON.stringify(first)}`,
      );

    const cursor = first['cursor'];
    const results = Array.isArray(first['results']) ? first['results'] : [];
    expect(first['complete']).toBe(false);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ path: 'a.txt', cut: true });

    const second = await session.call('fs.grep', {
      ...params,
      cursor,
    });

    expect(second).toMatchObject({
      ok: true,
      complete: true,
      results: [{ path: 'b.txt' }],
    });
  });
});
