import { describe, expect, it } from 'vitest';

import { frozenRuntimeDefinition, isStdio } from './mcp-runtime-definition';

describe('frozenRuntimeDefinition', () => {
  it('copies and freezes remote protected values', () => {
    const protectedValues = ['remote-secret'];
    const result = frozenRuntimeDefinition({
      url: 'https://mcp.example.test',
      protectedValues,
    });
    if (isStdio(result)) throw new Error('expected a remote definition');

    expect(result.protectedValues).toEqual(['remote-secret']);
    expect(result.protectedValues).not.toBe(protectedValues);
    expect(Object.isFrozen(result.protectedValues)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('copies and freezes remote headers and the injected fetch', () => {
    const headers = { authorization: 'Bearer token' };
    const fetch = (): Promise<Response> => Promise.resolve(new Response(''));
    const result = frozenRuntimeDefinition({
      url: 'https://mcp.example.test',
      headers,
      fetch,
    });
    if (isStdio(result)) throw new Error('expected a remote definition');

    expect(result.headers).toEqual({ authorization: 'Bearer token' });
    expect(result.headers).not.toBe(headers);
    expect(Object.isFrozen(result.headers)).toBe(true);
    expect(result.fetch).toBe(fetch);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('leaves absent remote members absent', () => {
    const result = frozenRuntimeDefinition({ url: 'https://mcp.example.test' });

    expect(result).toEqual({ url: 'https://mcp.example.test' });
  });

  it('copies and freezes every stdio member a caller could mutate', () => {
    const args = ['--stdio'];
    const env = { TOKEN: 'stdio-secret' };
    const protectedValues = ['stdio-secret'];
    const result = frozenRuntimeDefinition({
      transport: 'stdio',
      command: 'node',
      args,
      env,
      cwd: '/workspace',
      protectedValues,
    });
    if (!isStdio(result)) throw new Error('expected a stdio definition');

    expect(result).toEqual({
      transport: 'stdio',
      command: 'node',
      args: ['--stdio'],
      env: { TOKEN: 'stdio-secret' },
      cwd: '/workspace',
      protectedValues: ['stdio-secret'],
    });
    expect(result.args).not.toBe(args);
    expect(result.env).not.toBe(env);
    expect(result.protectedValues).not.toBe(protectedValues);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.args)).toBe(true);
    expect(Object.isFrozen(result.env)).toBe(true);
    expect(Object.isFrozen(result.protectedValues)).toBe(true);
  });

  it('leaves absent stdio members absent', () => {
    const result = frozenRuntimeDefinition({
      transport: 'stdio',
      command: 'node',
    });

    expect(result).toEqual({ transport: 'stdio', command: 'node' });
    expect(isStdio(result)).toBe(true);
  });
});
