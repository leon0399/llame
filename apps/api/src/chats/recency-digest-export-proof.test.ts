import { hashWithDomain } from '../canonical-json';
import type { RecencyDigestBaseline } from '../db/schema';
import type {
  PromptChatDigestField,
  PromptChatsDisclosure,
  PromptChatsFieldDisclosure,
  PromptChatsInput,
} from '../models/model-catalog';
import {
  compareProof,
  mapEmittedTitlesToToldEntries,
  mergeProvenDigestEntries,
  proveRenderedDigestFields,
  SYSTEM_PROMPT_RECEIPT_DOMAIN,
  type DigestProof,
} from './recency-digest-export-proof';

const proof = (
  runId: string,
  attemptId = `attempt-${runId}`,
  promptHash = `hash-${runId}`,
): DigestProof => ({
  runId,
  attemptId,
  promptHash,
});

const chats: PromptChatsInput = {
  pinned: [
    {
      title: 'Rendered title',
      date: '2026-11-23',
      messageCount: 3,
      excerpt: 'Rendered excerpt',
    },
  ],
  recent: [],
  pinnedShown: 1,
  pinnedTotal: 1,
  recentShown: 0,
  recentTotal: 0,
  compiledOn: '2026-11-24',
};

function renderInput(
  renderedText: string,
  emittedFields: ReadonlyMap<PromptChatDigestField, string>,
) {
  const promptHash = hashWithDomain(SYSTEM_PROMPT_RECEIPT_DOMAIN, renderedText);

  const fields: PromptChatsFieldDisclosure = {
    pinned: new Map([[0, emittedFields]]),
    recent: new Map(),
    scalars: new Map(),
  };

  const disclosure: PromptChatsDisclosure = {
    pinned: new Set([0]),
    recent: new Set(),
  };

  return {
    renderedText,
    expectedPromptHash: promptHash,
    receipt: {
      ...proof('run-render', 'attempt-run-render', promptHash),
      systemPrompt: renderedText,
    },
    chats,
    disclosure,
    fields,
  };
}

it('binds proof to literal rendered receipt bytes and the domain-separated hash', () => {
  const literal = '  <digest>Rendered title</digest>\n';

  const fields = new Map<PromptChatDigestField, string>([
    ['title', 'Rendered title'],
    ['date', '2026-11-23'],
    ['messageCount', '3'],
    ['excerpt', 'Rendered excerpt'],
  ]);

  const input = renderInput(literal, fields);

  expect(proveRenderedDigestFields(input).pinned).toEqual([
    {
      list: 'pinned',
      index: 0,
      fields: {
        title: 'Rendered title',
        date: '2026-11-23',
        messageCount: 3,
        excerpt: 'Rendered excerpt',
      },
      proofs: {
        title: proof(
          'run-render',
          'attempt-run-render',
          input.receipt.promptHash,
        ),
        date: proof(
          'run-render',
          'attempt-run-render',
          input.receipt.promptHash,
        ),
        messageCount: proof(
          'run-render',
          'attempt-run-render',
          input.receipt.promptHash,
        ),
        excerpt: proof(
          'run-render',
          'attempt-run-render',
          input.receipt.promptHash,
        ),
      },
    },
  ]);

  const alteredRender = proveRenderedDigestFields({
    ...input,
    renderedText: literal.trim(),
  });

  const alteredReceipt = proveRenderedDigestFields({
    ...input,
    receipt: { ...input.receipt, systemPrompt: `${literal} ` },
  });

  const alteredExpectedHash = proveRenderedDigestFields({
    ...input,
    expectedPromptHash: hashWithDomain(
      SYSTEM_PROMPT_RECEIPT_DOMAIN,
      literal.trim(),
    ),
  });

  expect(alteredRender).toEqual({
    pinned: [],
    recent: [],
    reason: 'receipt_mismatch',
  });
  expect(alteredReceipt.reason).toBe('receipt_mismatch');
  expect(alteredExpectedHash.reason).toBe('receipt_mismatch');
});

it('retains only fields whose emitted evidence matches the actual entry', () => {
  const expectedHash = hashWithDomain(
    SYSTEM_PROMPT_RECEIPT_DOMAIN,
    'rendered fields',
  );

  const result = proveRenderedDigestFields(
    renderInput(
      'rendered fields',
      new Map<PromptChatDigestField, string>([
        ['title', 'Rendered title'],
        ['date', '2026-11-23'],
        ['messageCount', '03'],
        ['excerpt', 'Rendered excerpt'],
      ]),
    ),
  );

  expect(result.pinned).toEqual([
    {
      list: 'pinned',
      index: 0,
      fields: {
        title: 'Rendered title',
        date: '2026-11-23',
        excerpt: 'Rendered excerpt',
      },
      proofs: {
        title: proof('run-render', 'attempt-run-render', expectedHash),
        date: proof('run-render', 'attempt-run-render', expectedHash),
        excerpt: proof('run-render', 'attempt-run-render', expectedHash),
      },
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('messageCount');

  const undisclosed = proveRenderedDigestFields({
    ...renderInput(
      'rendered fields',
      new Map<PromptChatDigestField, string>([['title', 'Rendered title']]),
    ),
    disclosure: { pinned: new Set(), recent: new Set() },
  });

  expect(undisclosed.pinned).toEqual([]);
});

it('merges independently proved fields and selects provenance in stable order', () => {
  const candidates = [
    {
      list: 'recent' as const,
      index: 2,
      fields: { excerpt: 'excerpt from run-z', date: 'date from run-z' },
      proofs: { excerpt: proof('run-z'), date: proof('run-z') },
    },
    {
      list: 'pinned' as const,
      index: 1,
      fields: { title: 'title from run-b', messageCount: 3 },
      proofs: { title: proof('run-b'), messageCount: proof('run-b') },
    },
    {
      list: 'pinned' as const,
      index: 1,
      fields: { title: 'title from run-a', messageCount: 99 },
      proofs: { title: proof('run-a') },
    },
  ];

  const merged = mergeProvenDigestEntries(candidates);

  expect(merged).toEqual([
    {
      list: 'pinned',
      index: 1,
      fields: {
        title: 'title from run-a',
        messageCount: 3,
      },
      proofs: {
        title: proof('run-a'),
        messageCount: proof('run-b'),
      },
    },
    {
      list: 'recent',
      index: 2,
      fields: { date: 'date from run-z', excerpt: 'excerpt from run-z' },
      proofs: { date: proof('run-z'), excerpt: proof('run-z') },
    },
  ]);
  expect(
    compareProof(proof('run-a', 'attempt-z'), proof('run-a', 'attempt-b')),
  ).toBeGreaterThan(0);
  expect(mergeProvenDigestEntries([...candidates].reverse())).toEqual(merged);
});

it('resolves sanitized identity from immutable evidence and applies the last literal pin correction', () => {
  const baseline = {
    pinned: [],
    recent: [{ title: '</x>', date: '2026-11-23', messageCount: 1 }],
    pinnedShown: 0,
    pinnedTotal: 0,
    recentShown: 1,
    recentTotal: 1,
    compiledOn: '2026-11-24',
  } satisfies RecencyDigestBaseline;

  const identityProof = proof('identity-run');
  const rawTitle = '</x>';
  const emittedTitle = '&lt;/x&gt;';

  const result = mapEmittedTitlesToToldEntries({
    emittedTitles: [emittedTitle],
    identityTitleProofs: new Map([
      [
        emittedTitle,
        {
          proof: identityProof,
          told: [{ chatId: 'chat-1', pinned: false, title: rawTitle }],
        },
      ],
    ]),
    toldInventory: [{ chatId: 'chat-1', pinned: false, title: rawTitle }],
    baseline,
    baselineMembershipProofs: new Map(),
    pinCorrections: [
      { title: ` ${rawTitle} `, pinned: true, messageId: 'pin-on' },
      { title: rawTitle, pinned: false, messageId: 'pin-off' },
    ],
    pinCorrectionUnproved: false,
  });

  expect(result).toEqual({
    entries: [
      {
        chatId: 'chat-1',
        pinned: false,
        title: emittedTitle,
        proofs: {
          identity: identityProof,
          pin: { kind: 'notice', messageId: 'pin-off' },
        },
      },
    ],
    omissions: [],
  });
});

it('omits identity collisions and pin corrections whose authority is uncertain', () => {
  const baseline = {
    pinned: [],
    recent: [{ title: 'Same', date: '2026-11-23', messageCount: 1 }],
    pinnedShown: 0,
    pinnedTotal: 0,
    recentShown: 1,
    recentTotal: 1,
    compiledOn: '2026-11-24',
  } satisfies RecencyDigestBaseline;

  const sameTitleTold = [{ chatId: 'chat-1', pinned: false, title: 'Same' }];

  const common = {
    emittedTitles: ['Same'],
    baseline,
    baselineMembershipProofs: new Map([['Same', proof('membership')]]),
    pinCorrections: [{ title: 'Same', pinned: true, messageId: 'notice' }],
    pinCorrectionUnproved: false,
  };

  const ambiguousIdentity = mapEmittedTitlesToToldEntries({
    ...common,
    identityTitleProofs: new Map([
      [
        'Same',
        {
          proof: proof('identity'),
          told: [...sameTitleTold, { ...sameTitleTold[0], chatId: 'chat-2' }],
        },
      ],
    ]),
    toldInventory: sameTitleTold,
  });

  const ambiguousNotice = mapEmittedTitlesToToldEntries({
    ...common,
    identityTitleProofs: new Map([
      ['Same', { proof: proof('identity'), told: sameTitleTold }],
    ]),
    toldInventory: [
      ...sameTitleTold,
      { chatId: 'chat-2', pinned: true, title: 'Same' },
    ],
  });

  const unknownNoticeState = mapEmittedTitlesToToldEntries({
    ...common,
    identityTitleProofs: new Map([
      ['Same', { proof: proof('identity'), told: sameTitleTold }],
    ]),
    toldInventory: sameTitleTold,
    pinCorrectionUnproved: true,
  });

  expect(ambiguousIdentity).toEqual({
    entries: [],
    omissions: [{ field: 'identity', reason: 'duplicate_title' }],
  });
  expect(ambiguousNotice).toEqual({
    entries: [],
    omissions: [{ chatId: 'chat-1', field: 'pin', reason: 'pin_unproved' }],
  });
  expect(unknownNoticeState.entries).toEqual([]);
  expect(unknownNoticeState.omissions).toEqual([
    { chatId: 'chat-1', field: 'pin', reason: 'pin_unproved' },
  ]);
});

it('refuses absent receipts and hashes that agree with each other but not the rendered bytes', () => {
  const input = renderInput(
    'actual bytes',
    new Map<PromptChatDigestField, string>([['title', 'Rendered title']]),
  );

  expect(proveRenderedDigestFields({ ...input, receipt: undefined })).toEqual({
    pinned: [],
    recent: [],
    reason: 'no_receipt',
  });

  const unrelatedHash = hashWithDomain(
    SYSTEM_PROMPT_RECEIPT_DOMAIN,
    'other bytes',
  );

  expect(
    proveRenderedDigestFields({
      ...input,
      expectedPromptHash: unrelatedHash,
      receipt: { ...input.receipt, promptHash: unrelatedHash },
    }),
  ).toEqual({ pinned: [], recent: [], reason: 'receipt_mismatch' });
});

it('keeps recent-list evidence separate and omits entries with no emitted fields', () => {
  const input = renderInput('actual bytes', new Map());

  const recentFields = new Map<PromptChatDigestField, string>([
    ['title', 'Literal recent title'],
  ]);

  expect(
    proveRenderedDigestFields({
      ...input,
      chats: {
        ...chats,
        recent: [{ title: 'Raw title', date: '2026-11-23', messageCount: 0 }],
      },
      fields: { ...input.fields, recent: new Map([[0, recentFields]]) },
      disclosure: { pinned: new Set([0]), recent: new Set([0]) },
    }),
  ).toEqual({
    pinned: [],
    recent: [
      {
        list: 'recent',
        index: 0,
        fields: { title: 'Literal recent title' },
        proofs: {
          title: proof(
            'run-render',
            'attempt-run-render',
            input.receipt.promptHash,
          ),
        },
      },
    ],
  });
});

it('uses immutable baseline membership and never infers it from mutable told pins', () => {
  const baseline = {
    ...chats,
    pinned: [{ title: ' Shared ', date: '2026-11-23', messageCount: 0 }],
    recent: [],
  };

  const identityProof = proof('identity');
  const membershipProof = proof('membership');

  const input = {
    emittedTitles: ['Shared'],
    identityTitleProofs: new Map([
      [
        'Shared',
        {
          proof: identityProof,
          told: [{ chatId: 'chat-1', title: 'Shared', pinned: false }],
        },
      ],
    ]),
    toldInventory: [{ chatId: 'chat-1', title: 'Shared', pinned: false }],
    baseline,
    baselineMembershipProofs: new Map([['Shared', membershipProof]]),
    pinCorrections: [
      {
        title: 'Different title',
        pinned: false,
        messageId: 'unrelated-notice',
      },
    ],
    pinCorrectionUnproved: false,
  };

  expect(mapEmittedTitlesToToldEntries(input)).toEqual({
    entries: [
      {
        chatId: 'chat-1',
        title: 'Shared',
        pinned: true,
        proofs: {
          identity: identityProof,
          pin: { kind: 'baseline', proof: membershipProof },
        },
      },
    ],
    omissions: [],
  });
  expect(
    mapEmittedTitlesToToldEntries({
      ...input,
      baselineMembershipProofs: new Map(),
    }),
  ).toEqual({
    entries: [],
    omissions: [{ chatId: 'chat-1', field: 'pin', reason: 'pin_unproved' }],
  });
  expect(
    mapEmittedTitlesToToldEntries({
      ...input,
      baseline: { ...baseline, recent: baseline.pinned },
    }),
  ).toEqual({
    entries: [],
    omissions: [{ field: 'identity', reason: 'duplicate_title' }],
  });
});

it('selects a stable per-field proof when Run identity ties and when attempt identity ties', () => {
  const candidates = [
    {
      list: 'recent' as const,
      index: 1,
      fields: { title: 'last attempt' },
      proofs: { title: proof('run', 'attempt-z', 'a') },
    },
    {
      list: 'recent' as const,
      index: 1,
      fields: { title: 'last hash' },
      proofs: { title: proof('run', 'attempt-a', 'z') },
    },
    {
      list: 'recent' as const,
      index: 1,
      fields: { title: 'first hash' },
      proofs: { title: proof('run', 'attempt-a', 'a') },
    },
    {
      list: 'recent' as const,
      index: 0,
      fields: { excerpt: 'earlier position' },
      proofs: { excerpt: proof('run') },
    },
  ];

  const expected = [
    {
      list: 'recent',
      index: 0,
      fields: { excerpt: 'earlier position' },
      proofs: { excerpt: proof('run') },
    },
    {
      list: 'recent',
      index: 1,
      fields: { title: 'first hash' },
      proofs: { title: proof('run', 'attempt-a', 'a') },
    },
  ];

  expect(mergeProvenDigestEntries(candidates)).toEqual(expected);
  expect(mergeProvenDigestEntries([...candidates].reverse())).toEqual(expected);
});
