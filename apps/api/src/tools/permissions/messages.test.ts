import { describe, expect, it } from 'vitest';

import { permissionDeniedResult, rejectedHopUrl } from './messages';

describe('rejectedHopUrl', () => {
  it('strips control characters and bounds the locator at 2,048 characters', () => {
    expect(rejectedHopUrl('https://docs.example.com/a\u0007b')).toBe(
      'https://docs.example.com/ab',
    );

    const long = rejectedHopUrl(`https://docs.example.com/${'a'.repeat(4096)}`);
    expect(long).toHaveLength(2048);
    expect(long.startsWith('https://docs.example.com/aaa')).toBe(true);
  });

  it('never echoes query or fragment text of an unparsable locator', () => {
    expect(rejectedHopUrl('not a url?token=secret#part')).toBe('not a url');
  });
});

describe('permissionDeniedResult', () => {
  it('returns the exact fixed read-only text', () => {
    expect(permissionDeniedResult('permission_mode_read_only').message).toBe(
      'Tool call rejected before execution. This Run permits only reads and Workspace entry or exit without a worktree. Do not retry this call, disguise the same action through different commands or tools, or delegate it to another agent. In-run approval is unavailable. Continue with other permitted work; if this action is required, explain the blocked step to the user.',
    );
  });

  it('names no permission mode and no setting in the read-only text', () => {
    const { message } = permissionDeniedResult('permission_mode_read_only');
    expect(message).not.toContain('read-only');
    expect(message).not.toContain('permissionModes');
  });

  it('carries no locator field for a submitted call', () => {
    for (const reason of [
      'explicit_reject',
      'no_allow',
      'invalid_field',
      'input_limit',
      'permission_mode_read_only',
    ] as const) {
      expect(Object.keys(permissionDeniedResult(reason)).sort()).toEqual([
        'message',
        'status',
        'type',
      ]);
    }
  });
});
