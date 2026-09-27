import { describe, expect, it } from 'vitest';

import { frozenRuntimeDefinition } from './mcp-runtime-definition';

describe('frozenRuntimeDefinition', () => {
  it('copies and freezes remote protected values', () => {
    const protectedValues = ['remote-secret'];
    const result = frozenRuntimeDefinition({
      url: 'https://mcp.example.test',
      protectedValues,
    });

    expect(result.protectedValues).toEqual(['remote-secret']);
    expect(result.protectedValues).not.toBe(protectedValues);
    expect(Object.isFrozen(result.protectedValues)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
