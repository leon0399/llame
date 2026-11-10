import { type TenantRunner } from '../db/tenant-db.service';
import { nativeReadTool } from '../tools/native-files';
import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import { type ToolPermissionMap } from '../tools/permissions/types';
import { previewToolPermission } from '../tools/runner';
import { type ToolContext } from '../tools/types';
import { modelGitAdmission } from './model-git-admission';

const tenantDb: TenantRunner = {
  runAs: <T>() =>
    Promise.reject<T>(new Error('tenant DB is not used by these tests')),
};

function context(
  map: ToolPermissionMap,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    userId: 'owner',
    chatId: 'chat',
    tenantDb,
    configuredCredentials: [],
    permissionPolicy: compileToolPermissionMap(map, 'git-admission-policy'),
    ...overrides,
  };
}

/** The admission the producer builds: the allowlist plus the read preview. */
function admission(
  map: ToolPermissionMap,
  options: {
    readAllowlisted?: boolean;
    mode?: ToolContext['permissionMode'];
  } = {},
) {
  const toolContext = context(map, { permissionMode: options.mode });

  return modelGitAdmission({
    readAllowlisted: options.readAllowlisted ?? true,
    admitsRead: (path) =>
      previewToolPermission(nativeReadTool, { path }, toolContext),
  });
}

const DOT_GIT = String.raw`/\.git(/|$)`;

describe('modelGitAdmission', () => {
  it('admits when read is allowlisted and the read group allows the entry', () => {
    expect(admission({ read: { allow: true } })('/repo/.git')).toBe(true);
  });

  it('refuses without read in tools.allowed, whatever the policy says', () => {
    expect(
      admission(
        { read: { allow: true } },
        { readAllowlisted: false },
      )('/repo/.git'),
    ).toBe(false);
    expect(
      admission(
        { read: { allow: true } },
        { readAllowlisted: false, mode: 'bypass' },
      )('/repo/.git'),
    ).toBe(false);
  });

  it('does not ask the read preview when read is not allowlisted', () => {
    const admitsRead = vi.fn(() => true);

    expect(
      modelGitAdmission({ readAllowlisted: false, admitsRead })('/repo/.git'),
    ).toBe(false);
    expect(admitsRead).not.toHaveBeenCalled();
  });

  it('evaluates the git entry path as the path value', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: [{ field: 'path', regex: '^/home/dev/src/llame/\\.git$' }],
      },
    };

    expect(admission(map)('/home/dev/src/llame/.git')).toBe(true);
    expect(admission(map)('/home/dev/src/llame/.git/HEAD')).toBe(false);
    expect(admission(map)('/home/dev/src/llame')).toBe(false);
  });

  it('refuses the git directory that a reject clause matches, and still admits the project', () => {
    const map: ToolPermissionMap = {
      read: { allow: true, reject: [{ field: 'path', regex: DOT_GIT }] },
    };

    const check = admission(map);

    expect(check('/home/user/Projects/monorepo/.git')).toBe(false);
    expect(check('/home/user/Projects/monorepo/project')).toBe(true);
  });

  it('refuses a reject-matched entry in default and read-only, and admits it in bypass', () => {
    const map: ToolPermissionMap = {
      read: { allow: true, reject: [{ field: 'path', regex: DOT_GIT }] },
    };

    expect(admission(map, { mode: 'default' })('/repo/.git')).toBe(false);
    expect(admission(map, { mode: 'read-only' })('/repo/.git')).toBe(false);
    expect(admission(map, { mode: 'bypass' })('/repo/.git')).toBe(true);
  });

  it('keeps git state in read-only mode when the read group admits the entry', () => {
    expect(
      admission({ read: { allow: true } }, { mode: 'read-only' })('/repo/.git'),
    ).toBe(true);
  });

  it('admits a linked worktree by its own .git file while the main clone is rejected', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [{ field: 'path', literal: '/home/dev/main/.git' }],
      },
    };

    const check = admission(map);

    expect(check('/home/dev/worktrees/w/.git')).toBe(true);
    expect(check('/home/dev/main/.git')).toBe(false);
  });

  it('is not decided by the bash group', () => {
    const bashAllowsGit: ToolPermissionMap = {
      bash: { allow: [{ field: 'command', regex: '^git status$' }] },
      read: { allow: true, reject: [{ field: 'path', regex: DOT_GIT }] },
    };

    const bashRejectsGit: ToolPermissionMap = {
      bash: { allow: true, reject: [{ field: 'command', regex: '^git' }] },
      read: { allow: true },
    };

    const bashOnly: ToolPermissionMap = {
      bash: { allow: true },
    };

    expect(admission(bashAllowsGit)('/repo/.git')).toBe(false);
    expect(admission(bashRejectsGit)('/repo/.git')).toBe(true);
    expect(admission(bashOnly)('/repo/.git')).toBe(false);
  });
});
