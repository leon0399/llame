import { describe, expect, it } from 'vitest';

import {
  createWorkspaceMachineAvailabilityItem,
  isMachineName,
  isWorkspaceMachinePayload,
  renderMachineWorkspaceSnapshot,
} from './machine-context-item-producers';

const RUN_ID = '11111111-2222-4333-8444-555555555555';

/** The envelope every authored context item carries. */
function envelope(attributes: string, body: string): string {
  return [
    `<system-reminder ${attributes}>`,
    'Inserted by llame; not written by the user.',
    body,
    '</system-reminder>',
  ].join('\n');
}

describe('Machine name guard', () => {
  it('accepts exactly the operator configuration key grammar', () => {
    expect(isMachineName('build-1')).toBe(true);
    expect(isMachineName('a')).toBe(true);
    expect(isMachineName('0')).toBe(true);
    expect(isMachineName('a'.repeat(63))).toBe(true);
    expect(isMachineName('a'.repeat(64))).toBe(false);
    expect(isMachineName('')).toBe(false);
    expect(isMachineName('Build-1')).toBe(false);
    expect(isMachineName('build_1')).toBe(false);
    expect(isMachineName('build 1')).toBe(false);
    expect(isMachineName('machine://build-1')).toBe(false);
    expect(isMachineName('build-1\n')).toBe(false);
  });

  it('rejects every non-string value', () => {
    for (const value of [undefined, null, 42, true, {}, []]) {
      expect(isMachineName(value)).toBe(false);
    }
  });
});

describe('Workspace Machine payload guard', () => {
  it('accepts exactly one machine key holding a Machine name', () => {
    expect(isWorkspaceMachinePayload({ machine: 'build-1' })).toBe(true);
  });

  it('rejects a wrong key set, a missing key, or a bad name', () => {
    expect(isWorkspaceMachinePayload({})).toBe(false);
    expect(isWorkspaceMachinePayload({ machine: 'build-1', root: '/' })).toBe(
      false,
    );
    expect(isWorkspaceMachinePayload({ machine: 'Build-1' })).toBe(false);
    expect(isWorkspaceMachinePayload({ machine: '' })).toBe(false);
    expect(isWorkspaceMachinePayload({ machine: 7 })).toBe(false);
    expect(isWorkspaceMachinePayload({ machine: undefined })).toBe(false);
    expect(isWorkspaceMachinePayload({ host: 'build-1' })).toBe(false);
    expect(isWorkspaceMachinePayload(null)).toBe(false);
    expect(isWorkspaceMachinePayload('build-1')).toBe(false);
  });
});

describe('Machine Workspace snapshot body', () => {
  it('names the Machine and the root as the binding wrote them', () => {
    expect(
      renderMachineWorkspaceSnapshot('machine://build-1/home/operator/app'),
    ).toBe(
      [
        'The active Workspace working root is `machine://build-1/home/operator/app`, on Machine `build-1`.',
        "Machine operations run as that Machine's own OS user without sandboxing; the Machine's registered roots bound addressing only, and that user can change them. Every hub user bound to the same Machine shares that one OS user, so the Machine itself provides no isolation between them.",
      ].join('\n'),
    );
  });

  it('canonicalizes the Machine name without rewriting the root text', () => {
    expect(renderMachineWorkspaceSnapshot('machine://BUILD-1/Work/App')).toBe(
      [
        'The active Workspace working root is `machine://BUILD-1/Work/App`, on Machine `build-1`.',
        "Machine operations run as that Machine's own OS user without sandboxing; the Machine's registered roots bound addressing only, and that user can change them. Every hub user bound to the same Machine shares that one OS user, so the Machine itself provides no isolation between them.",
      ].join('\n'),
    );
  });

  it('narrates a Machine root that is the machine filesystem root itself', () => {
    expect(renderMachineWorkspaceSnapshot('machine://build-1/')).toBe(
      [
        'The active Workspace working root is `machine://build-1/`, on Machine `build-1`.',
        "Machine operations run as that Machine's own OS user without sandboxing; the Machine's registered roots bound addressing only, and that user can change them. Every hub user bound to the same Machine shares that one OS user, so the Machine itself provides no isolation between them.",
      ].join('\n'),
    );
  });

  it('returns undefined for every root that is not a Machine path', () => {
    for (const root of [
      '/home/operator/app',
      'relative/path',
      '',
      'machine://',
      'machine://build-1',
      'machine://Build_1/app',
      'file://localhost/home/operator/app',
    ]) {
      expect(renderMachineWorkspaceSnapshot(root)).toBeUndefined();
    }
  });
});

describe('Workspace Machine availability item', () => {
  it('narrates recovery as a workspace notice on the Machine binding', () => {
    const item = createWorkspaceMachineAvailabilityItem({
      runId: RUN_ID,
      machine: 'build-1',
      available: true,
    });

    expect(item.data.producer).toBe('workspace');
    expect(item.data.form).toBe('notice');
    expect(item.data.runId).toBe(RUN_ID);
    expect(item.data.payload).toEqual({ machine: 'build-1' });
    expect(item.data.text).toBe(
      envelope(
        'producer="workspace" form="notice"',
        [
          'Machine `build-1` is reachable again, so the Workspace bound to it is online.',
          'Relative paths resolve on `machine://build-1/...` as before, with no new `enter_workspace` needed.',
        ].join('\n'),
      ),
    );
  });

  it('narrates unavailability as the same producer and form', () => {
    const item = createWorkspaceMachineAvailabilityItem({
      runId: RUN_ID,
      machine: 'build-1',
      available: false,
    });

    expect(item.data.producer).toBe('workspace');
    expect(item.data.form).toBe('notice');
    expect(item.data.payload).toEqual({ machine: 'build-1' });
    expect(item.data.text).toBe(
      envelope(
        'producer="workspace" form="notice"',
        [
          'Machine `build-1` is unreachable, so this Workspace is offline for now.',
          'The Workspace stays entered: relative paths and `machine://build-1/...` targets fail with `machine_unavailable` until it answers again, and a path on another host or Machine still works.',
        ].join('\n'),
      ),
    );
  });

  it('rejects a Machine that is not a configuration key', () => {
    for (const machine of ['Build 1', '', 'build_1']) {
      expect(() =>
        createWorkspaceMachineAvailabilityItem({
          runId: RUN_ID,
          machine,
          available: true,
        }),
      ).toThrow('Invalid server-authored Workspace Machine metadata');
    }
  });
});
