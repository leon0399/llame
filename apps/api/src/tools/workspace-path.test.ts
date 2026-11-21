import { describe, expect, it } from 'vitest';

import {
  canonicalMachineLocator,
  createWorkspaceRootCell,
  currentMachine,
  isWorkspaceRelative,
  machineWorkspaceRoot,
  mapToWorkspaceHost,
  NO_CURRENT_MACHINE_MESSAGE,
  resolveMachinePath,
  resolveWorkspacePath,
} from './workspace-path';

const BOUND = {
  workspaceRoot: 'machine://gpu/srv/app',
  defaultMachine: 'devl',
  localMachine: 'devl',
} as const;

describe('resolveMachinePath', () => {
  it('resolves a bare absolute path on the bound Workspace Machine', () => {
    expect(resolveMachinePath('/etc/hostname', BOUND)).toEqual({
      kind: 'machine',
      name: 'gpu',
      path: '/etc/hostname',
      locator: 'machine://gpu/etc/hostname',
      local: false,
    });
  });

  it('resolves a bare absolute path on the default Machine when unbound', () => {
    expect(
      resolveMachinePath('/etc/hostname', {
        defaultMachine: 'devl',
        localMachine: 'devl',
      }),
    ).toEqual({
      kind: 'machine',
      name: 'devl',
      path: '/etc/hostname',
      locator: 'machine://devl/etc/hostname',
      local: true,
    });
  });

  it.each([
    'file:///etc/hostname',
    'file://localhost/etc/hostname',
    'file:/etc/hostname',
    'FILE:///etc/hostname',
    'file:///etc/%68ostname',
  ])('resolves %s on the current Machine', (value) => {
    expect(resolveMachinePath(value, { defaultMachine: 'devl' })).toEqual({
      kind: 'machine',
      name: 'devl',
      path: '/etc/hostname',
      locator: 'machine://devl/etc/hostname',
      local: false,
    });
  });

  it('refuses a file alias that names another host', () => {
    expect(
      resolveMachinePath('file://other.example/etc/hostname', {
        defaultMachine: 'devl',
      }),
    ).toEqual({
      kind: 'invalid',
      message:
        'A file:// URL with a host other than localhost names another Machine. ' +
        'Use machine://<name>/<path> to reach a configured Machine.',
    });
  });

  it('refuses a malformed file alias with the decoder message', () => {
    expect(
      resolveMachinePath('file:///etc/pass%ZZwd', { defaultMachine: 'devl' }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('resolves a relative path lexically on the Workspace root Machine', () => {
    expect(resolveMachinePath('src/app.ts', BOUND)).toEqual({
      kind: 'machine',
      name: 'gpu',
      path: '/srv/app/src/app.ts',
      locator: 'machine://gpu/srv/app/src/app.ts',
      local: false,
    });
    expect(resolveMachinePath('../shared/', BOUND)).toMatchObject({
      path: '/srv/shared/',
      locator: 'machine://gpu/srv/shared/',
    });
    expect(resolveMachinePath('../../..', BOUND)).toMatchObject({
      path: '/',
      locator: 'machine://gpu/',
    });
    expect(resolveMachinePath('src/app.ts:10-20', BOUND)).toEqual({
      kind: 'machine',
      name: 'gpu',
      path: '/srv/app/src/app.ts',
      locator: 'machine://gpu/srv/app/src/app.ts:10-20',
      local: false,
      selector: '10-20',
    });
  });

  it('refuses a relative path without an entered Workspace', () => {
    expect(
      resolveMachinePath('src/app.ts', { defaultMachine: 'devl' }),
    ).toEqual({
      kind: 'invalid',
      message: 'A relative path needs an entered Workspace to resolve from.',
    });
  });

  it('reads a legacy bare Workspace root on the default Machine', () => {
    expect(
      resolveMachinePath('src/app.ts', {
        workspaceRoot: '/srv/app',
        defaultMachine: 'devl',
      }),
    ).toMatchObject({ locator: 'machine://devl/srv/app/src/app.ts' });
    expect(
      resolveMachinePath('src/app.ts', { workspaceRoot: '/srv/app' }),
    ).toEqual({ kind: 'invalid', message: NO_CURRENT_MACHINE_MESSAGE });
  });

  it('resolves machine:// and marks the local Machine', () => {
    expect(
      resolveMachinePath('MACHINE://DEVL/srv/app', { localMachine: 'devl' }),
    ).toEqual({
      kind: 'machine',
      name: 'devl',
      path: '/srv/app',
      locator: 'machine://devl/srv/app',
      local: true,
    });
    expect(
      resolveMachinePath('machine://gpu/srv/a%23b.md:5-6', {
        localMachine: 'devl',
      }),
    ).toEqual({
      kind: 'machine',
      name: 'gpu',
      path: '/srv/a#b.md',
      locator: 'machine://gpu/srv/a%23b.md:5-6',
      local: false,
      selector: '5-6',
    });
  });

  it('refuses a malformed machine:// path', () => {
    expect(resolveMachinePath('machine://bad_name/x', BOUND)).toMatchObject({
      kind: 'invalid',
    });
    expect(resolveMachinePath('machine://devl/a%00b', BOUND)).toMatchObject({
      kind: 'invalid',
    });
  });

  it.each([
    'machine://',
    'machine://gpu',
    'kb://Space/notes/a',
    'skill://pdf',
    'media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f',
    'job://bash-1',
    'projects://',
    'artifact://bash-1/stdout',
    'ssh://box/notes',
    'http://example.test/',
    'HTTPS://example.test/x',
  ])('keeps %s for its own reader', (value) => {
    expect(resolveMachinePath(value, BOUND)).toEqual({ kind: 'scheme' });
  });

  it('refuses an unknown scheme instead of reading it as a path', () => {
    expect(resolveMachinePath('vault://notes/a.md', BOUND)).toEqual({
      kind: 'invalid',
      message: 'This path scheme is not available.',
    });
  });

  it('refuses a bare path when there is no current Machine', () => {
    expect(resolveMachinePath('/etc/hostname', {})).toEqual({
      kind: 'invalid',
      message: NO_CURRENT_MACHINE_MESSAGE,
    });
  });

  it('keeps a trailing separator and a read selector apart', () => {
    expect(
      resolveMachinePath('/srv/app/', { defaultMachine: 'devl' }),
    ).toMatchObject({ path: '/srv/app/', locator: 'machine://devl/srv/app/' });
    expect(
      resolveMachinePath('/srv/app.ts:5-6', { defaultMachine: 'devl' }),
    ).toMatchObject({
      path: '/srv/app.ts',
      selector: '5-6',
      locator: 'machine://devl/srv/app.ts:5-6',
    });
    // A suffix the selector grammar refuses stays part of the file name.
    expect(
      resolveMachinePath('/srv/notes:draft', { defaultMachine: 'devl' }),
    ).toMatchObject({
      path: '/srv/notes:draft',
      locator: 'machine://devl/srv/notes%3Adraft',
    });
  });
});

describe('currentMachine', () => {
  it('reports the bound root Machine, else the default Machine', () => {
    expect(currentMachine(BOUND)).toBe('gpu');
    expect(currentMachine({ defaultMachine: 'devl' })).toBe('devl');
    expect(
      currentMachine({ workspaceRoot: '/srv/app', defaultMachine: 'devl' }),
    ).toBe('devl');
    expect(currentMachine({})).toBeUndefined();
  });
});

describe('workspace path projection', () => {
  it('resolves lexically and preserves a trailing separator', () => {
    expect(resolveWorkspacePath('/work/project', 'src/app.ts')).toBe(
      '/work/project/src/app.ts',
    );
    expect(resolveWorkspacePath('/work/project', '../shared/data.json')).toBe(
      '/work/shared/data.json',
    );
    expect(resolveWorkspacePath('/work/project', 'app.ts/')).toBe(
      '/work/project/app.ts/',
    );
  });

  it('recognizes relative paths without treating schemes as local paths', () => {
    expect(isWorkspaceRelative('src/app.ts')).toBe(true);
    expect(isWorkspaceRelative('../shared')).toBe(true);
    expect(isWorkspaceRelative('/work/project/src')).toBe(false);
    expect(isWorkspaceRelative('KB://Space/file')).toBe(false);
    expect(isWorkspaceRelative('vault://notes/file')).toBe(false);
    expect(
      isWorkspaceRelative('media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f'),
    ).toBe(false);
    expect(isWorkspaceRelative('media://')).toBe(false);
  });

  it('does not treat file: aliases as workspace-relative', () => {
    expect(isWorkspaceRelative('file:/etc/passwd')).toBe(false);
    expect(isWorkspaceRelative('file:///etc/passwd')).toBe(false);
    expect(isWorkspaceRelative('FILE:/x')).toBe(false);
    expect(isWorkspaceRelative('file:')).toBe(false);
  });

  it('commits root changes and claims one transition per model step', () => {
    const cell = createWorkspaceRootCell('/work/old');

    expect(cell.current()).toBe('/work/old');
    cell.commit('/work/new');
    expect(cell.current()).toBe('/work/old');
    expect(cell.claimTransition()).toBe(true);
    expect(cell.claimTransition()).toBe(false);

    cell.beginStep();
    expect(cell.current()).toBe('/work/new');
    expect(cell.claimTransition()).toBe(true);
    expect(cell.claimTransition()).toBe(false);

    cell.commit(undefined);
    expect(cell.current()).toBe('/work/new');
    expect(cell.claimTransition()).toBe(false);
    cell.beginStep();
    expect(cell.current()).toBeUndefined();
    expect(cell.claimTransition()).toBe(true);
  });

  it('does not add a second separator when the resolved root is filesystem root', () => {
    expect(resolveWorkspacePath('/', '/')).toBe('/');
    expect(resolveWorkspacePath('/', 'child/')).toBe('/child/');
  });

  it('resolves a relative path on a Machine root to the Machine locator', () => {
    const root = 'machine://devl/home/me/shop';
    expect(resolveWorkspacePath(root, 'src/app.ts')).toBe(
      'machine://devl/home/me/shop/src/app.ts',
    );
    expect(resolveWorkspacePath(root, '../shared/data.json')).toBe(
      'machine://devl/home/me/shared/data.json',
    );
    expect(resolveWorkspacePath(root, 'app.ts/')).toBe(
      'machine://devl/home/me/shop/app.ts/',
    );
    expect(resolveWorkspacePath('machine://devl/', 'srv')).toBe(
      'machine://devl/srv',
    );
  });

  it('keeps a read selector when resolving a Machine Workspace path', () => {
    expect(
      resolveWorkspacePath('machine://devl/srv/app', 'src/app.ts:10-20'),
    ).toBe('machine://devl/srv/app/src/app.ts:10-20');
  });

  it('keeps an absolute Machine path as written rather than re-resolving it', () => {
    expect(
      resolveWorkspacePath('machine://devl/srv/app', '/srv/app/../x'),
    ).toBe('machine://devl/srv/app/../x');
  });

  it('never doubles the separator when a Machine path resolves to the root', () => {
    expect(resolveWorkspacePath('machine://devl/srv/app', '../../..')).toBe(
      'machine://devl/',
    );
  });

  it('refuses a Machine Workspace path that cannot be a locator', () => {
    expect(() =>
      resolveWorkspacePath('machine://devl/srv/app', 'a\u0000b'),
    ).toThrow('The Machine Workspace path cannot be a locator.');
  });

  it('leaves a suffix that is not a read selector on the Machine path', () => {
    expect(
      mapToWorkspaceHost('machine://devl/srv/app', '/srv/app/notes:draft'),
    ).toBe('machine://devl/srv/app/notes%3Adraft');
  });

  it('maps a bare absolute path to the Machine bound to the Workspace', () => {
    const root = 'machine://devl/home/me/shop';
    expect(mapToWorkspaceHost(root, '/home/me/notes.md')).toBe(
      'machine://devl/home/me/notes.md',
    );
    expect(mapToWorkspaceHost(root, '/home/me/a#b.md')).toBe(
      'machine://devl/home/me/a%23b.md',
    );
    expect(mapToWorkspaceHost(root, '/home/me/x.ts:3-4')).toBe(
      'machine://devl/home/me/x.ts:3-4',
    );
    // Nothing that is not a bare absolute path is rewritten.
    expect(mapToWorkspaceHost(root, 'notes.md')).toBe('notes.md');
    expect(mapToWorkspaceHost(root, 'file:/home/me/notes.md')).toBe(
      'file:/home/me/notes.md',
    );
    expect(mapToWorkspaceHost(root, 'machine://gpu/x')).toBe('machine://gpu/x');
    // A local root passes everything through untouched.
    expect(mapToWorkspaceHost('/home/me/shop', '/etc/hosts')).toBe(
      '/etc/hosts',
    );
    expect(mapToWorkspaceHost(undefined, '/etc/hosts')).toBe('/etc/hosts');
  });

  it('recognizes a Machine Workspace root and fails closed on another root', () => {
    expect(machineWorkspaceRoot('machine://devl/home/me/shop')).toEqual({
      name: 'devl',
      path: '/home/me/shop',
    });
    expect(machineWorkspaceRoot('machine://devl')).toBeUndefined();
    expect(machineWorkspaceRoot('/home/me/shop')).toBeUndefined();
    expect(machineWorkspaceRoot(undefined)).toBeUndefined();
    expect(() => resolveWorkspacePath('relative/root', 'src/app.ts')).toThrow(
      /absolute host path or a machine:\/\/ locator/u,
    );
  });

  it('canonicalizes a Machine locator without touching other text', () => {
    expect(canonicalMachineLocator('MACHINE://DEVL/home/me/a%23b.md')).toBe(
      'machine://devl/home/me/a%23b.md',
    );
    expect(canonicalMachineLocator('machine://devl/home/me/x.ts:3-4')).toBe(
      'machine://devl/home/me/x.ts:3-4',
    );
    expect(canonicalMachineLocator('machine://devl')).toBe('machine://devl');
    expect(canonicalMachineLocator('machine://bad_name/x')).toBe(
      'machine://bad_name/x',
    );
    expect(canonicalMachineLocator('/home/me/a.ts')).toBe('/home/me/a.ts');
  });
});
