import { describe, expect, it } from 'vitest';

import {
  buildContext,
  renderConversationCheckpoint,
  type MessagePart,
} from './context-builder';
import type { CompactionReplacementMessage } from '../db/schema';
import {
  createTemporalItem,
  isTemporalPayload,
} from './context-item-producers';
import { type ContextItemPart } from './context-item';
import { contentBlockTexts, contentText } from '../testing/support';

const RUN_ID = '11111111-2222-4333-8444-555555555555';
const INSTANT = new Date('2026-08-19T16:36:00.000Z');

function compactionReplacementHistory(
  summary: string,
): Array<CompactionReplacementMessage> {
  return [
    {
      role: 'user',
      parts: [{ type: 'text', text: renderConversationCheckpoint(summary) }],
    },
  ];
}

type TemporalOverrides = { instant?: string; timeZone?: string };

const historicalTemporalPart = (
  overrides: { instant?: unknown; timeZone?: unknown } = {},
): ContextItemPart => ({
  type: 'data-context',
  data: {
    v: 1,
    producer: 'temporal',
    form: 'snapshot',
    runId: RUN_ID,
    payload: {
      instant: '2026-08-19T16:36:00.000Z',
      timeZone: 'Europe/Madrid',
      ...overrides,
    },
  },
});

const temporalPart = (overrides: TemporalOverrides = {}) =>
  createTemporalItem({
    runId: RUN_ID,
    instant: new Date(overrides.instant ?? INSTANT),
    timeZone: overrides.timeZone ?? 'Europe/Madrid',
  });

describe('temporal payload validation', () => {
  it('accepts an ISO instant with a known IANA zone', () => {
    expect(
      isTemporalPayload({
        instant: '2026-08-19T16:36:00.000Z',
        timeZone: 'Europe/Madrid',
      }),
    ).toBe(true);
  });

  it.each([
    ['an extra field', { extra: true }],
    ['a non-ISO instant', { instant: '2026-08-19 16:36' }],
    [
      'a local-time instant without a zone designator',
      {
        instant: '2026-08-19T16:36:00.000',
      },
    ],
    ['a calendar date only', { instant: '2026-08-19' }],
    ['an unknown timezone', { timeZone: 'Mars/Olympus' }],
    ['a UTC offset in place of a zone', { timeZone: '+02:00' }],
    ['a calendar-invalid date', { instant: '2026-02-30T16:36:00.000Z' }],
    ['an out-of-range hour', { instant: '2026-08-19T24:36:00.000Z' }],
    ['a non-string instant', { instant: 1_755_620_160_000 }],
  ])('rejects %s', (_label, override) => {
    expect(
      isTemporalPayload({
        instant: '2026-08-19T16:36:00.000Z',
        timeZone: 'Europe/Madrid',
        ...override,
      }),
    ).toBe(false);
  });

  it('rejects a payload missing either field', () => {
    expect(isTemporalPayload({ instant: '2026-08-19T16:36:00.000Z' })).toBe(
      false,
    );
    expect(isTemporalPayload({ timeZone: 'Europe/Madrid' })).toBe(false);
  });

  it('round-trips through the item factory', () => {
    const item = createTemporalItem({
      runId: RUN_ID,
      instant: INSTANT,
      timeZone: 'Europe/Madrid',
    });
    expect(item.data.producer).toBe('temporal');
    expect(item.data.form).toBe('snapshot');
    expect(item.data.payload).toEqual({
      instant: '2026-08-19T16:36:00.000Z',
      timeZone: 'Europe/Madrid',
    });
    expect(item.data.text).toContain(
      'Message received: 2026-08-19 18:36+02:00 (Europe/Madrid)',
    );
  });

  it('refuses to author an item in an unknown timezone', () => {
    expect(() =>
      createTemporalItem({
        runId: RUN_ID,
        instant: INSTANT,
        timeZone: 'Mars/Olympus',
      }),
    ).toThrow(TypeError);
  });
});

describe('temporal rendering', () => {
  it('states receipt in the stored zone, with a numeric offset', () => {
    expect(temporalPart().data.text).toContain(
      'Message received: 2026-08-19 18:36+02:00 (Europe/Madrid)',
    );
  });

  it('renders a fractional-hour offset exactly', () => {
    // The rendered label is the runtime's canonical spelling of the stored
    // zone, which for some identifiers is the legacy alias.
    const canonical = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kathmandu',
    }).resolvedOptions().timeZone;
    expect(temporalPart({ timeZone: 'Asia/Kathmandu' }).data.text).toContain(
      `Message received: 2026-08-19 22:21+05:45 (${canonical})`,
    );
  });

  it('renders UTC with a zero offset', () => {
    expect(temporalPart({ timeZone: 'UTC' }).data.text).toContain(
      'Message received: 2026-08-19 16:36+00:00 (UTC)',
    );
  });

  it('does not read the process timezone', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      const west = temporalPart().data.text;
      process.env.TZ = 'Asia/Tokyo';
      const east = temporalPart().data.text;
      // The zone travels with the row, so the process that renders a
      // conversation cannot disagree with the one that accepted the turn.
      expect(west).toBe(east);
    } finally {
      process.env.TZ = original;
    }
  });

  it('keeps invalid historical metadata-only rows inert', () => {
    expect(
      historicalTemporalPart({ timeZone: 'Mars/Olympus' }).data.text,
    ).toBeUndefined();
  });
});

describe('temporal rows in assembled context', () => {
  const systemPrompt = 'You are llame.';
  const msg = (input: {
    seq: number;
    role: 'user' | 'assistant';
    parts: Array<MessagePart>;
  }) => ({
    id: `msg-${input.seq}`,
    chatId: 'chat-1',
    seq: input.seq,
    role: input.role,
    senderUserId: input.role === 'user' ? 'user-alice' : null,
    parts: input.parts,
    attachments: [],
    createdAt: new Date('2026-08-19T16:36:00.000Z'),
  });

  const conversation = [
    msg({
      seq: 1,
      role: 'user',
      parts: [temporalPart(), { type: 'text', text: 'First question.' }],
    }),
    msg({
      seq: 2,
      role: 'assistant',
      parts: [{ type: 'text', text: 'Reply.' }],
    }),
    msg({
      seq: 3,
      role: 'user',
      parts: [
        temporalPart({ instant: '2026-08-19T17:10:00.000Z' }),
        { type: 'text', text: 'Second question.' },
      ],
    }),
  ];

  it('dates every user turn and no assistant turn', () => {
    const result = buildContext(conversation, { systemPrompt });

    const rendered = result.messages.map((m) => contentText(m.content));
    expect(rendered[0]).toContain('Message received: 2026-08-19 18:36+02:00');
    expect(rendered[0]).toContain('First question.');
    expect(rendered[1]).toBe('Reply.');
    expect(rendered[2]).toContain('Message received: 2026-08-19 19:10+02:00');
    // The gap between turns is readable from the transcript itself.
    expect(rendered[2]).toContain('Second question.');
  });

  it('renders the row ahead of the user text, in its own block', () => {
    const [first] = buildContext(conversation, { systemPrompt }).messages;
    const blocks = contentBlockTexts(first.content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('Message received:');
    expect(blocks[1]).toBe('First question.');
  });

  it('replays byte-identically however much later it is read', () => {
    const first = buildContext(conversation, { systemPrompt });
    const second = buildContext(conversation, { systemPrompt });
    // The property the whole design rests on: no message's serialized form
    // changes between requests, so the cached prefix stays valid.
    expect(JSON.stringify(second.messages)).toBe(
      JSON.stringify(first.messages),
    );
  });

  it('records each row in the run record', () => {
    const { contextItems } = buildContext(conversation, { systemPrompt });
    expect(contextItems).toHaveLength(2);
    for (const item of contextItems) {
      expect(item).toMatchObject({
        producer: 'temporal',
        form: 'snapshot',
        residency: 'rail',
      });
      expect(item.text).toContain('Message received:');
    }
  });

  it('leaves a turn that predates the feature untouched', () => {
    const legacy = msg({
      seq: 1,
      role: 'user',
      parts: [{ type: 'text', text: 'sent before rows existed' }],
    });

    const result = buildContext([legacy], { systemPrompt });

    // A single block, which the provider adapter collapses back to a plain
    // string — the same wire form the turn had before the rail existed.
    expect(contentBlockTexts(result.messages[0].content)).toEqual([
      'sent before rows existed',
    ]);
    expect(result.contextItems).toEqual([]);
  });

  it('states a receipt, never the present instant', () => {
    const row = temporalPart().data.text;

    // The format/zone conversion itself is pinned against independent literals
    // by 'states receipt in the stored zone, with a numeric offset' and
    // 'renders UTC with a zero offset' above. What is left to assert here is
    // the wording claim: a receipt, not a "current" time.
    expect(row).toContain('Message received:');
    expect(row).not.toContain('Current');
  });

  it('drops rows superseded by a compaction along with their turns', () => {
    const { contextItems } = buildContext(conversation, {
      systemPrompt,
      compaction: {
        summary: 'earlier history',
        uptoSeq: 2,
        replacementHistory: compactionReplacementHistory('earlier history'),
      },
    });
    expect(
      contextItems.filter((item) => item.producer === 'temporal'),
    ).toHaveLength(1);
  });
});
