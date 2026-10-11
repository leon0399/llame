import { describe, expect, it } from 'vitest';

import { placeAcceptedTurnItems } from './accepted-turn-parts.repository';
import {
  createContextItemPart,
  isContextItemPart,
  type AuthoredContextItemPart,
  type ContextItemProducer,
} from './context-item';

const RUN_ID = '11111111-2222-4333-8444-555555555555';
const USER_TEXT = { type: 'text' as const, text: 'hello' };

/** Each part's producer and text, or `text` for a user-authored part. */
function labelsOf(parts: ReadonlyArray<unknown>): Array<string> {
  return parts.map((part) =>
    isContextItemPart(part)
      ? `${part.data.producer}:${part.data.text ?? ''}`
      : 'text',
  );
}

function item(
  producer: ContextItemProducer,
  text: string = producer,
): AuthoredContextItemPart {
  return createContextItemPart({
    producer,
    form: 'notice',
    runId: RUN_ID,
    payload: {},
    text,
  });
}

describe('placeAcceptedTurnItems', () => {
  it('places a first dispatch at producer rank around the facts stored before it', () => {
    const stored = [
      item('skill-activation'),
      item('prompt-imports'),
      USER_TEXT,
    ];

    const placed = placeAcceptedTurnItems(
      stored,
      [
        item('effective-context-change'),
        item('tool-availability'),
        item('workspace'),
        item('instructions'),
        item('recency-digest'),
        item('temporal'),
      ],
      'rank',
    );

    expect(labelsOf(placed)).toEqual([
      'effective-context-change:effective-context-change',
      'tool-availability:tool-availability',
      'workspace:workspace',
      'instructions:instructions',
      'skill-activation:skill-activation',
      'prompt-imports:prompt-imports',
      'recency-digest:recency-digest',
      'temporal:temporal',
      'text',
    ]);
  });

  it('keeps emission order for items of the same producer', () => {
    const placed = placeAcceptedTurnItems(
      [USER_TEXT],
      [item('workspace', 'snapshot'), item('workspace', 'detach')],
      'rank',
    );

    expect(labelsOf(placed)).toEqual([
      'workspace:snapshot',
      'workspace:detach',
      'text',
    ]);
  });

  it('appends a retry after the last stored item and before the user text, in emission order', () => {
    const stored = [
      item('tool-availability', 'first'),
      item('prompt-imports'),
      item('temporal'),
      USER_TEXT,
    ];

    const placed = placeAcceptedTurnItems(
      stored,
      [item('tool-availability', 'second'), item('workspace', 'detach')],
      'append',
    );

    expect(labelsOf(placed)).toEqual([
      'tool-availability:first',
      'prompt-imports:prompt-imports',
      'temporal:temporal',
      'tool-availability:second',
      'workspace:detach',
      'text',
    ]);
  });

  it('stores a repeated item again rather than treating it as already present', () => {
    const repeated = item('tool-availability', 'Unavailable tools: a');
    const placed = placeAcceptedTurnItems(
      [repeated, item('tool-availability', 'Now available: a'), USER_TEXT],
      [repeated],
      'append',
    );

    expect(labelsOf(placed)).toEqual([
      'tool-availability:Unavailable tools: a',
      'tool-availability:Now available: a',
      'tool-availability:Unavailable tools: a',
      'text',
    ]);
  });

  it('leaves the input unchanged', () => {
    const stored = [USER_TEXT];
    placeAcceptedTurnItems(stored, [item('temporal')], 'rank');
    expect(stored).toEqual([USER_TEXT]);
  });
});
