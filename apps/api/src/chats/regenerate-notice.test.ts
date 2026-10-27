/**
 * The `regenerate` notice producer and the decision that decides whether a
 * Regenerate owes it (turn-actions D9). Pure: a stored tool part in, a boolean
 * out, and the rendered item for the producer.
 */

import { type ToolClassification } from '../tools/types';
import {
  createRegenerateNoticeItem,
  discardsNonReadOnlyCall,
  isRegenerateNoticePayload,
} from './regenerate-notice';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

type StoredPart = {
  type: string;
  toolCallId: string;
  state: 'output-available' | 'output-error';
  input: Record<string, never>;
  outcome: string;
  classification?: unknown;
};

/** A stored tool part; `'absent'` leaves the field out, as a legacy row does. */
function toolPart(
  toolName: string,
  classification: ToolClassification | null | 'absent',
  state: StoredPart['state'] = 'output-available',
): StoredPart {
  return {
    type: `tool-${toolName}`,
    toolCallId: 'call-1',
    state,
    input: {},
    outcome: 'success',
    ...(classification !== 'absent' && { classification }),
  };
}

describe('discardsNonReadOnlyCall', () => {
  it('counts a call whose recorded classification is not read_only', () => {
    expect(discardsNonReadOnlyCall(toolPart('bash', 'execute_code'))).toBe(
      true,
    );
    expect(discardsNonReadOnlyCall(toolPart('edit', 'write_low_risk'))).toBe(
      true,
    );
    expect(
      discardsNonReadOnlyCall(toolPart('mcp__demo__x', 'unverified')),
    ).toBe(true);
  });

  it('never counts a read-only call', () => {
    expect(discardsNonReadOnlyCall(toolPart('read', 'read_only'))).toBe(false);
    // The recorded classification decides, even when the tool catalog would
    // have said otherwise: a `bash` call recorded as read-only ran no effect.
    expect(discardsNonReadOnlyCall(toolPart('bash', 'read_only'))).toBe(false);
  });

  it('never counts a call that did not start', () => {
    // The availability gate or the permission policy rejected it, so nothing
    // ran and the new attempt has no effects to miss.
    expect(discardsNonReadOnlyCall(toolPart('bash', null))).toBe(false);
    expect(
      discardsNonReadOnlyCall(toolPart('bash', null, 'output-error')),
    ).toBe(false);
  });

  it('falls back to the tool catalog for a legacy part with no field', () => {
    expect(discardsNonReadOnlyCall(toolPart('read', 'absent'))).toBe(false);
    expect(discardsNonReadOnlyCall(toolPart('bash', 'absent'))).toBe(true);
    // An MCP id is `unverified`, and a name the catalog does not know counts.
    expect(discardsNonReadOnlyCall(toolPart('mcp__demo__x', 'absent'))).toBe(
      true,
    );
    expect(discardsNonReadOnlyCall(toolPart('ghost_tool', 'absent'))).toBe(
      true,
    );
  });

  it('ignores parts that are not settled tool calls', () => {
    expect(discardsNonReadOnlyCall({ type: 'text', text: 'hi' })).toBe(false);
    expect(
      discardsNonReadOnlyCall({ type: 'tool-bash', toolCallId: 'c' }),
    ).toBe(false);
    expect(discardsNonReadOnlyCall(null)).toBe(false);
  });
});

describe('createRegenerateNoticeItem', () => {
  it('renders the packaged notice as one recognized rail item', () => {
    const item = createRegenerateNoticeItem({ runId: RUN_ID });

    expect(item.data).toMatchObject({
      v: 1,
      producer: 'regenerate',
      form: 'notice',
      runId: RUN_ID,
      payload: { reason: 'non_read_only_calls' },
    });
    expect(item.data.text).toBe(
      [
        '<system-reminder producer="regenerate" form="notice">',
        'Inserted by llame; not written by the user.',
        'An earlier attempt at this turn was discarded after it ran tools that can change files or other state. Check the current state before you act on it.',
        '</system-reminder>',
      ].join('\n'),
    );
  });

  it('accepts only the exact payload', () => {
    expect(isRegenerateNoticePayload({ reason: 'non_read_only_calls' })).toBe(
      true,
    );
    expect(isRegenerateNoticePayload({ reason: 'other' })).toBe(false);
    expect(
      isRegenerateNoticePayload({ reason: 'non_read_only_calls', x: 1 }),
    ).toBe(false);
  });
});
