import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { InstanceConfigService } from '../../instance-config/instance-config.service';
import { BUILT_IN_TOOL_PERMISSIONS } from './built-in-policy';
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
  it('compiles the built-in map and stamps an opaque policy id', async () => {
    const policy = await buildToolPermissionPolicy(BUILT_IN_TOOL_PERMISSIONS);
    expect(policy.groups.size).toBe(7);
    expect(policy.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
  });

  it('generates a distinct id for each process even with identical config', async () => {
    const first = await buildToolPermissionPolicy(BUILT_IN_TOOL_PERMISSIONS);
    const second = await buildToolPermissionPolicy(BUILT_IN_TOOL_PERMISSIONS);
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

  it('does not field-validate MCP groups at boot', async () => {
    const policy = await buildToolPermissionPolicy({
      mcp__docs__fetch: { allow: [{ field: 'anything', literal: 'x' }] },
    });
    expect(policy.groups.has('mcp__docs__fetch')).toBe(true);
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
