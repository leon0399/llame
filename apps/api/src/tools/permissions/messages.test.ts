import { describe, expect, it } from 'vitest';

import {
  permissionDeniedResult,
  rejectedHopResult,
  rejectedHopUrl,
  REJECTED_HOP_MESSAGE,
} from './messages';

/** The fixed hop template, pinned here independently of the implementation. */
const HOP_MESSAGE =
  'Tool call stopped by operator permissions. A redirect target was refused before its content was read; the refused target is in rejectedUrl. Do not retry this call, disguise the same target through another tool, or delegate it to another agent. In-run approval is unavailable. Continue with other permitted work; if this content is required, explain the blocked target to the user.';

describe('rejectedHopResult', () => {
  it('is a permission error carrying the message and the bounded locator', () => {
    expect(
      rejectedHopResult('https://docs.example.com/start?token=secret#part'),
    ).toEqual({
      status: 'error',
      type: 'permission_denied',
      message: HOP_MESSAGE,
      rejectedUrl: 'https://docs.example.com/start',
    });
    expect(REJECTED_HOP_MESSAGE).toBe(HOP_MESSAGE);
  });

  it('interpolates nothing, so every hop carries the identical message', () => {
    const first = rejectedHopResult('https://docs.example.com/start');
    const second = rejectedHopResult('https://other.example/guide?q=1');

    expect(first.message).toBe(HOP_MESSAGE);
    expect(second.message).toBe(HOP_MESSAGE);
    expect(first.message).not.toMatch(/https?:|docs\.example\.com/u);
  });

  it('drops a signed query string and a fragment from the refused locator', () => {
    const result = rejectedHopResult(
      'https://docs.example.com/report?X-Amz-Signature=signed-value#top',
    );

    expect(result.rejectedUrl).toBe('https://docs.example.com/report');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('signed-value');
    expect(serialized).not.toContain('X-Amz-Signature');
    expect(serialized).not.toContain('#top');
  });

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
  it('carries no locator field for a submitted call', () => {
    for (const reason of [
      'explicit_reject',
      'no_allow',
      'invalid_field',
      'input_limit',
    ] as const) {
      expect(Object.keys(permissionDeniedResult(reason)).sort()).toEqual([
        'message',
        'status',
        'type',
      ]);
    }
  });
});
