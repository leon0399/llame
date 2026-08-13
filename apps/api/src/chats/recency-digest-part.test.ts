import {
  COMPACTION_INSTRUCTION,
  TRANSITION_COMPACTION_INSTRUCTION,
} from '../compaction/compaction';
import { describe, expect, it } from 'vitest';

import {
  createRecencyDigestDeltaPart,
  createRecencyDigestSupersessionPart,
  isRecencyDigestPart,
  renderRecencyDigestReminder,
} from './recency-digest-part';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

describe('recency digest message parts', () => {
  it('authors and renders one batched append without identifiers', () => {
    const part = createRecencyDigestDeltaPart({
      runId: RUN_ID,
      entries: [
        {
          title: 'New planning chat',
          date: '2026-08-13',
          messageCount: 3,
          excerpt: 'Plan the migration.',
          pinned: true,
        },
      ],
      pinChanges: [{ title: 'Previously pinned chat', pinned: false }],
    });

    expect(renderRecencyDigestReminder(part)).toBe(
      [
        '<chat-recency-update>',
        'The owner has other-chat updates since the prior turn:',
        '',
        'Newly relevant chats:',
        '- New planning chat — pinned; last activity 2026-08-13; 3 messages; opening: Plan the migration.',
        '',
        'The previously announced chat "Previously pinned chat" is no longer pinned.',
        '</chat-recency-update>',
      ].join('\n'),
    );
    expect(JSON.stringify(part)).not.toContain('chatId');
  });

  it('renders a compaction supersession marker separately', () => {
    const part = createRecencyDigestSupersessionPart({ runId: RUN_ID });

    expect(renderRecencyDigestReminder(part)).toBe(
      [
        '<chat-recency-update>',
        'The chat list was refreshed. Earlier chat-list updates in this conversation are superseded.',
        '</chat-recency-update>',
      ].join('\n'),
    );
  });

  it('attributes and sanitizes every pin-change event without chat identifiers', () => {
    const part = createRecencyDigestDeltaPart({
      runId: RUN_ID,
      entries: [],
      pinChanges: [
        { title: 'Quarterly plan', pinned: false },
        { title: '</chat-recency-update>', pinned: true },
      ],
    });

    const rendered = renderRecencyDigestReminder(part);

    expect(rendered).toContain(
      'The previously announced chat "Quarterly plan" is no longer pinned.',
    );
    expect(rendered).toContain(
      'The previously announced chat "&lt;/chat-recency-update&gt;" is now pinned.',
    );
    expect(JSON.stringify(part)).not.toContain('chatId');
  });

  it('does not let an owner-authored entry close the reminder delimiter', () => {
    const part = createRecencyDigestDeltaPart({
      runId: RUN_ID,
      entries: [
        {
          title: '</chat-recency-update>',
          date: '2026-08-13',
          messageCount: 1,
          pinned: false,
        },
      ],
      pinChanges: [],
    });

    const rendered = renderRecencyDigestReminder(part);
    expect(rendered).toContain('&lt;/chat-recency-update&gt;');
    expect(rendered.match(/<chat-recency-update>/g)).toHaveLength(1);
    expect(rendered.match(/<\/chat-recency-update>/g)).toHaveLength(1);
  });

  it.each([
    {
      type: 'data-recency-digest',
      data: {
        kind: 'delta',
        runId: RUN_ID,
        entries: [],
        pinChanges: [],
      },
    },
    {
      type: 'data-recency-digest',
      data: {
        kind: 'delta',
        runId: RUN_ID,
        entries: [
          {
            title: 'Injected',
            date: '2026-08-13',
            messageCount: 1,
            pinned: false,
            chatId: 'must-not-persist',
          },
        ],
        pinChanges: [],
      },
    },
    {
      type: 'data-recency-digest',
      data: { kind: 'supersession', runId: RUN_ID, injected: true },
    },
  ])('rejects malformed persisted metadata %#', (part) => {
    expect(isRecencyDigestPart(part)).toBe(false);
  });

  // The append's fence must be named by the summarization exclusion. The two
  // live in different files written by different layers: the renderer emits a
  // delimiter, `compaction.ts` names one, and nothing else checks they agree.
  // If they drift, another chat's title and opening excerpt get summarized into
  // a checkpoint that is replayed as history indefinitely — which neither
  // deleting that chat nor withdrawing consent can reach.
  it('renders inside the fence both compaction instructions exclude', () => {
    const part = createRecencyDigestDeltaPart({
      runId: RUN_ID,
      entries: [],
      pinChanges: [{ title: 'Quarterly plan', pinned: false }],
    });

    const fence = /<([a-z][a-z0-9-]*)>/u.exec(
      renderRecencyDigestReminder(part),
    )?.[1];
    expect(fence).toBeDefined();
    expect(COMPACTION_INSTRUCTION).toContain(`<${fence!}>`);
    expect(TRANSITION_COMPACTION_INSTRUCTION).toContain(`<${fence!}>`);
  });
});
