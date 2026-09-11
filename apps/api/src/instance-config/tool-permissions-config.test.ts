import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type UnknownRecord } from '@workspace/runtime-safety';
import { beforeEach, describe, expect, it } from 'vitest';

import { BUILT_IN_TOOL_PERMISSIONS } from '../tools/permissions/built-in-policy';
import { loadInstanceConfig } from './config-loader';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'llame-tool-permissions-'));
});

function load(json: string, env: NodeJS.ProcessEnv = {}) {
  const file = path.join(dir, 'llame.config.json');
  writeFileSync(file, json);
  return loadInstanceConfig({ ...env, LLAME_CONFIG_PATH: file });
}

function loadError(json: string, env: NodeJS.ProcessEnv = {}): string {
  try {
    load(json, env);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error.message;
  }
  throw new Error('expected loadInstanceConfig to throw');
}

function tools(permissions: UnknownRecord): string {
  return JSON.stringify({ tools: { permissions } });
}

describe('tools.permissions configuration', () => {
  it('omitted selects the portable built-in map', () => {
    expect(load('{}').tools.permissions).toEqual(BUILT_IN_TOOL_PERMISSIONS);
  });

  it('an explicit empty map replaces the built-in map', () => {
    expect(load(tools({})).tools.permissions).toEqual({});
  });

  it('a supplied map replaces the built-in map wholesale', () => {
    expect(load(tools({ bash: { allow: true } })).tools.permissions).toEqual({
      bash: { allow: true },
    });
  });

  it('refuses a wildcard permission key', () => {
    expect(loadError(tools({ 'mcp__docs__*': { allow: true } }))).toMatch(
      /wildcard/,
    );
  });

  it('refuses an unknown code-owned id', () => {
    expect(loadError(tools({ nope: { allow: true } }))).toMatch(
      /unknown tool id/,
    );
  });

  it('refuses an MCP id for an undeclared server', () => {
    expect(loadError(tools({ mcp__docs__fetch: { allow: true } }))).toMatch(
      /undeclared/,
    );
  });

  it('accepts an exact MCP id for a declared server', () => {
    const json = JSON.stringify({
      mcpServers: { docs: { type: 'http', url: 'https://docs.test/mcp' } },
      tools: { permissions: { mcp__docs__fetch: { allow: true } } },
    });
    expect(load(json).tools.permissions).toEqual({
      mcp__docs__fetch: { allow: true },
    });
  });

  it('refuses allFields on an allow clause', () => {
    expect(
      loadError(
        tools({ bash: { allow: [{ allFields: true, literal: 'x' }] } }),
      ),
    ).toMatch(/allFields/);
  });

  it('refuses a clause that sets both matchers', () => {
    expect(() =>
      load(
        tools({
          bash: { allow: [{ field: 'command', literal: 'a', regex: 'b' }] },
        }),
      ),
    ).toThrow(/Invalid/);
  });

  it('refuses a clause without a target', () => {
    expect(() => load(tools({ bash: { allow: [{ literal: 'a' }] } }))).toThrow(
      /Invalid/,
    );
  });

  it('refuses an interpolation that resolves empty', () => {
    expect(
      loadError(
        tools({
          bash: { allow: [{ field: 'command', literal: '{env:PERM_EMPTY}' }] },
        }),
        { PERM_EMPTY: '' },
      ),
    ).toMatch(/must not be empty/);
  });

  it('interpolates configured pattern strings', () => {
    const resolved = load(
      tools({
        bash: { allow: [{ field: 'command', literal: '{env:PERM_LITERAL}' }] },
      }),
      { PERM_LITERAL: 'git push' },
    );
    expect(resolved.tools.permissions).toEqual({
      bash: { allow: [{ field: 'command', literal: 'git push' }] },
    });
  });

  it('applies doubled-brace escaping to pattern strings', () => {
    const resolved = load(
      tools({ bash: { reject: [{ field: 'command', regex: 'a{{b' }] } }),
    );
    expect(resolved.tools.permissions).toEqual({
      bash: { reject: [{ field: 'command', regex: 'a{b' }] },
    });
  });
});
