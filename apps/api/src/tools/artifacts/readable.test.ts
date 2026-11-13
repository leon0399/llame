/**
 * The artifact read surface of a Run (tool-result-artifacts "An artifact needs
 * a way to read it"): `read` with an admitted locator, or the host files a
 * host-bound `bash` opens. A Machine Workspace, a rejected `bash` group, or a
 * missing executor leaves the files unreachable, so the producer stores
 * nothing.
 */

import { drizzle } from 'drizzle-orm/postgres-js';

import { compileToolPermissionMap } from '../permissions/compile-permissions';
import { createWorkspaceRootCell } from '../workspace-path';
import { canReadArtifacts } from './readable';
import { type ToolContext } from '../types';

const MACHINE_ROOT = 'machine://devl/srv/app';

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  const db = drizzle.mock();

  return {
    userId: 'owner',
    chatId: 'chat',
    permissionPolicy: compileToolPermissionMap(
      { read: { allow: true }, bash: { allow: true } },
      'policy',
    ),
    tenantDb: {
      runAs: <T>(_userId: string, callback: (tx: typeof db) => Promise<T>) =>
        callback(db),
    },
    ...overrides,
    configuredCredentials: overrides.configuredCredentials ?? [],
  };
}

describe('the artifact readability predicate', () => {
  it('admits a Run that can read the locator', () => {
    expect(
      canReadArtifacts(
        context({
          artifactReadable: true,
          permissionPolicy: compileToolPermissionMap(
            { read: { allow: true }, bash: { reject: true } },
            'policy',
          ),
        }),
        'grep',
      ),
    ).toBe(true);
  });

  it('refuses a Run whose read group does not admit the locator', () => {
    expect(
      canReadArtifacts(
        context({
          artifactReadable: true,
          permissionPolicy: compileToolPermissionMap(
            {
              read: {
                allow: [{ field: 'path', literal: '/home/u/public' }],
              },
            },
            'policy',
          ),
        }),
        'grep',
      ),
    ).toBe(false);
  });

  it('admits a Run whose bash reaches the host files', () => {
    expect(
      canReadArtifacts(
        context({ artifactReadable: false, artifactHostFiles: true }),
        'bash',
      ),
    ).toBe(true);
  });

  it('refuses a Machine Workspace, whose bash opens no llame host path', () => {
    expect(
      canReadArtifacts(
        context({
          artifactReadable: false,
          artifactHostFiles: true,
          workspaceRoot: createWorkspaceRootCell(MACHINE_ROOT),
        }),
        'bash',
      ),
    ).toBe(false);
  });

  it('refuses a rejected bash group', () => {
    expect(
      canReadArtifacts(
        context({
          artifactReadable: false,
          artifactHostFiles: true,
          permissionPolicy: compileToolPermissionMap(
            { bash: { reject: true } },
            'policy',
          ),
        }),
        'bash',
      ),
    ).toBe(false);
  });

  it('probes the bash group with an empty command, not a missing field', () => {
    expect(
      canReadArtifacts(
        context({
          artifactReadable: false,
          artifactHostFiles: true,
          permissionPolicy: compileToolPermissionMap(
            { bash: { allow: [{ field: 'command', regex: '^$' }] } },
            'policy',
          ),
        }),
        'bash',
      ),
    ).toBe(true);
  });

  it('probes the bash group with the empty command, not a placeholder', () => {
    expect(
      canReadArtifacts(
        context({
          artifactReadable: false,
          artifactHostFiles: true,
          permissionPolicy: compileToolPermissionMap(
            {
              bash: {
                allow: true,
                reject: [{ field: 'command', regex: '^Stryker was here!$' }],
              },
            },
            'policy',
          ),
        }),
        'bash',
      ),
    ).toBe(true);
  });

  it('refuses a command-allow bash group the probe cannot satisfy', () => {
    expect(
      canReadArtifacts(
        context({
          artifactReadable: false,
          artifactHostFiles: true,
          permissionPolicy: compileToolPermissionMap(
            { bash: { allow: [{ field: 'command', literal: 'make test' }] } },
            'policy',
          ),
        }),
        'bash',
      ),
    ).toBe(false);
  });

  it('refuses a Run with no host files and no read', () => {
    expect(canReadArtifacts(context({ artifactReadable: false }), 'bash')).toBe(
      false,
    );
  });

  it('admits the host files of a bypass attempt', () => {
    expect(
      canReadArtifacts(
        context({
          artifactReadable: false,
          artifactHostFiles: true,
          permissionMode: 'bypass',
          permissionPolicy: compileToolPermissionMap(
            { bash: { reject: true } },
            'policy',
          ),
        }),
        'bash',
      ),
    ).toBe(true);
  });
});
