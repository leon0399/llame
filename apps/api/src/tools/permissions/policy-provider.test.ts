import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { InstanceConfigService } from '../../instance-config/instance-config.service';
import { PORTABLE_TOOL_PERMISSIONS } from '../../testing/portable-tool-policy';
import { PermissionCompileError } from './limits';
import {
  toolPermissionPolicyProvider,
  TOOL_PERMISSION_POLICY,
} from './permission-policy.module';
import { buildToolPermissionPolicy } from './policy-provider';
import { type CompiledPolicy, type ToolPermissionMap } from './types';

const invalidRegex: ToolPermissionMap = {
  bash: { allow: [{ field: 'command', regex: String.raw`(a)\1` }] },
};

describe('buildToolPermissionPolicy', () => {
  it('compiles the portable map and stamps an opaque policy id', async () => {
    const policy = await buildToolPermissionPolicy(PORTABLE_TOOL_PERMISSIONS);
    expect(policy.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
  });

  it('generates a distinct id for each process even with identical config', async () => {
    const first = await buildToolPermissionPolicy(PORTABLE_TOOL_PERMISSIONS);
    const second = await buildToolPermissionPolicy(PORTABLE_TOOL_PERMISSIONS);
    expect(first.id).not.toBe(second.id);
  });

  it('rejects an unsupported regex', async () => {
    await expect(
      buildToolPermissionPolicy(invalidRegex),
    ).rejects.toBeInstanceOf(PermissionCompileError);
  });

  it('rejects an unknown field on a code-owned tool', async () => {
    await expect(
      buildToolPermissionPolicy({
        read: { allow: [{ field: 'nope', literal: 'x' }] },
      }),
    ).rejects.toBeInstanceOf(PermissionCompileError);
  });

  it('accepts a declared string field on a code-owned tool', async () => {
    const policy = await buildToolPermissionPolicy({
      read: { allow: [{ field: 'path', literal: '/notes' }] },
    });

    expect(policy.groups.has('read')).toBe(true);
  });

  it('accepts the array-valued scopes field on grep and no other array', async () => {
    const policy = await buildToolPermissionPolicy({
      grep: { allow: [{ field: 'scopes', literal: '/home/u/' }] },
    });

    expect(policy.groups.has('grep')).toBe(true);
    await expect(
      buildToolPermissionPolicy({
        grep: { allow: [{ field: 'patterns', literal: 'x' }] },
      }),
    ).rejects.toBeInstanceOf(PermissionCompileError);
  });

  it('allows no other tool the grep scopes field', async () => {
    await expect(
      buildToolPermissionPolicy({
        read: { allow: [{ field: 'scopes', literal: 'x' }] },
      }),
    ).rejects.toBeInstanceOf(PermissionCompileError);
  });

  it('does not field-validate MCP groups at boot', async () => {
    const policy = await buildToolPermissionPolicy({
      mcp__docs__fetch: { allow: [{ field: 'anything', literal: 'x' }] },
    });

    expect(policy.groups.has('mcp__docs__fetch')).toBe(true);
  });

  describe('a regex anchored at a bare root on a path parameter', () => {
    const PATH_PARAMETERS = [
      ['read', 'path'],
      ['edit', 'path'],
      ['write', 'path'],
      ['enter_workspace', 'path'],
      ['grep', 'scopes'],
      ['bash', 'cwd'],
    ] as const;

    function bareRootMap(
      toolId: string,
      list: 'allow' | 'reject',
      field: string,
    ): ToolPermissionMap {
      return { [toolId]: { [list]: [{ field, regex: '^/srv/' }] } };
    }

    it.each(PATH_PARAMETERS)(
      'fails startup for %s.%s in an allow and a reject',
      async (toolId, field) => {
        for (const list of ['allow', 'reject'] as const) {
          await expect(
            buildToolPermissionPolicy(bareRootMap(toolId, list, field)),
          ).rejects.toThrow(
            new RegExp(`tools\\.permissions\\.${toolId}\\.${list}\\[0\\]`, 'u'),
          );
        }
      },
    );

    it('names the clause and points at the Machine locator', async () => {
      const failure = buildToolPermissionPolicy({
        read: {
          allow: [
            { field: 'path', literal: '/notes' },
            { field: 'path', regex: '^/srv/' },
          ],
        },
      });

      await expect(failure).rejects.toThrow(
        /tools\.permissions\.read\.allow\[1\]: a regex on a path parameter must not start with "\^\/".*machine:\/\/\[[^\]]+\]/u,
      );
    });

    it('accepts an escaped bare root and a literal clause', async () => {
      const policy = await buildToolPermissionPolicy({
        read: {
          allow: [{ field: 'path', literal: '/srv/' }],
          reject: [{ field: 'path', regex: String.raw`^\/srv\/private` }],
        },
      });

      expect(policy.groups.has('read')).toBe(true);
    });

    it('accepts a bare-root regex on a non-path field', async () => {
      const policy = await buildToolPermissionPolicy({
        bash: {
          allow: true,
          reject: [{ field: 'command', regex: '^/bin/rm' }],
        },
      });

      expect(policy.groups.has('bash')).toBe(true);
    });

    it('does not check an all-fields clause', async () => {
      const policy = await buildToolPermissionPolicy({
        read: { allow: true, reject: [{ allFields: true, regex: '^/srv' }] },
      });

      expect(policy.groups.has('read')).toBe(true);
    });
  });
});

describe('ToolPermissionPolicyModule boot', () => {
  it('aborts module initialization when the policy is invalid', async () => {
    const moduleRef = Test.createTestingModule({
      providers: [
        {
          provide: InstanceConfigService,
          useValue: { config: { tools: { permissions: invalidRegex } } },
        },
        toolPermissionPolicyProvider,
      ],
    }).compile();

    await expect(moduleRef).rejects.toBeInstanceOf(PermissionCompileError);
  });

  it('resolves the policy provider when the configuration is valid', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: InstanceConfigService,
          useValue: {
            config: { tools: { permissions: { bash: { allow: true } } } },
          },
        },
        toolPermissionPolicyProvider,
      ],
    }).compile();

    const policy = moduleRef.get<CompiledPolicy>(TOOL_PERMISSION_POLICY);
    expect(policy.groups.has('bash')).toBe(true);
  });
});
