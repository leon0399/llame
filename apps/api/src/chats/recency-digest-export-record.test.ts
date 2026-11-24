import type { Chat, RecencyDigestBaseline } from '../db/schema';
import type { ReconstructedDigestAttempts } from './recency-digest-export-attempts';
import { buildRecencyDigestExportRecord } from './recency-digest-export-record';

const baseline: RecencyDigestBaseline = {
  pinned: [],
  recent: [
    {
      title: 'Private title',
      date: '2026-11-23',
      messageCount: 2,
      excerpt: 'Private excerpt',
    },
  ],
  pinnedShown: 0,
  pinnedTotal: 0,
  recentShown: 1,
  recentTotal: 1,
  compiledOn: '2026-11-23',
};

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    ownerUserId: 'owner-1',
    title: null,
    visibility: 'private',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-23T00:00:00Z'),
    archivedAt: null,
    modelSelection: null,
    projectId: null,
    skillCatalogBaseline: null,
    skillCatalogRebakedFrom: null,
    skillCatalogTold: null,
    workspaceRoot: null,
    workspaceExecutorId: null,
    workspaceGeneration: 0,
    workspaceTold: null,
    artifactSeq: 0,
    workspaceToldAvailable: null,
    workspaceToldFrom: null,
    workspaceDetachReason: null,
    recencyDigestBaseline: baseline,
    recencyDigestTold: null,
    recencyDigestRebakedFrom: null,
    ...overrides,
  };
}

function attempts(
  overrides: Partial<ReconstructedDigestAttempts> = {},
): ReconstructedDigestAttempts {
  return {
    proofCandidates: [],
    emittedTitles: new Set<string>(),
    pinCorrections: [],
    pinCorrectionUnproved: false,
    matchedRun: null,
    identityTitleProofs: new Map(),
    baselineMembershipProofs: new Map(),
    latestPreTurn: null,
    anyReceipt: false,
    attemptNotDispatched: false,
    matchedReceipt: false,
    candidateUnavailable: false,
    baselinePublicationUnproved: false,
    baselinePublicationProved: false,
    provenScalars: {},
    scalarProofs: {},
    activeCheckpointId: null,
    lastOriginalSeq: 0,
    runCount: 0,
    ...overrides,
  };
}

it('projects only proven baseline values and records each omitted private field', () => {
  const record = buildRecencyDigestExportRecord({
    ownerId: 'owner-1',
    chat: chat(),
    attempts: attempts(),
  });

  expect(record).toMatchObject({
    ownerUserId: 'owner-1',
    chatId: 'chat-1',
    baseline: {
      entries: [],
      omissions: [
        { list: 'recent', index: 0, field: 'title', reason: 'no_receipt' },
        { list: 'recent', index: 0, field: 'date', reason: 'no_receipt' },
        {
          list: 'recent',
          index: 0,
          field: 'messageCount',
          reason: 'no_receipt',
        },
        { list: 'recent', index: 0, field: 'excerpt', reason: 'no_receipt' },
      ],
    },
  });
  expect(record.omissions).toContainEqual({
    scope: 'baseline',
    field: 'compiledOn',
    reason: 'no_run_provenance',
  });
  expect(record.omissions).toContainEqual({
    scope: 'baseline',
    field: 'recentShown',
    reason: 'no_run_provenance',
  });
  expect(JSON.stringify(record)).not.toContain('Private title');
  expect(JSON.stringify(record)).not.toContain('Private excerpt');
});

it('omits unproved identity and binds the fingerprint to rebake state', () => {
  const source = chat({
    recencyDigestTold: [
      { chatId: 'told-1', pinned: false, title: 'Told title' },
    ],
    recencyDigestRebakedFrom: 'checkpoint-1',
  });

  const record = buildRecencyDigestExportRecord({
    ownerId: 'owner-1',
    chat: source,
    attempts: attempts(),
  });

  expect(
    buildRecencyDigestExportRecord({
      ownerId: 'owner-1',
      chat: chat({ ...source, recencyDigestRebakedFrom: 'checkpoint-2' }),
      attempts: attempts(),
    }).fingerprint,
  ).not.toBe(record.fingerprint);
  expect(record.comparison.omissions).toContainEqual({
    chatId: 'told-1',
    field: 'identity',
    reason: 'unproved_told_id',
  });
  expect(record.omissions).toContainEqual({
    scope: 'comparison',
    field: '*',
    reason: 'comparison_proof_unavailable',
  });
  expect(
    buildRecencyDigestExportRecord({
      ownerId: 'owner-2',
      chat: source,
      attempts: attempts(),
    }).fingerprint,
  ).toBe(record.fingerprint);
});

it.each([
  {
    evidence: { baselinePublicationUnproved: true },
    reason: 'baseline_input_unproved',
  },
  { evidence: { matchedReceipt: true }, reason: 'emission_unproved' },
  {
    evidence: { attemptNotDispatched: true },
    reason: 'attempt_not_dispatched',
  },
  { evidence: { candidateUnavailable: true }, reason: 'input_unavailable' },
  { evidence: { anyReceipt: true }, reason: 'receipt_mismatch' },
  { evidence: { runCount: 1 }, reason: 'no_receipt' },
])('accounts for omitted private fields as $reason', ({ evidence, reason }) => {
  const record = buildRecencyDigestExportRecord({
    ownerId: 'owner-1',
    chat: chat(),
    attempts: attempts(evidence),
  });

  expect(record.baseline.omissions).toContainEqual({
    list: 'recent',
    index: 0,
    field: 'title',
    reason,
  });
  expect(record.omissions).toContainEqual({
    scope: 'baseline',
    field: 'compiledOn',
    reason,
  });
  expect(JSON.stringify(record)).not.toContain('Private title');
  expect(JSON.stringify(record)).not.toContain('Private excerpt');
});

it('distinguishes an absent baseline from unproved content and tool surfaces', () => {
  const record = buildRecencyDigestExportRecord({
    ownerId: 'owner-1',
    chat: chat({ recencyDigestBaseline: null }),
    attempts: attempts(),
  });

  expect(record.baseline.entries).toEqual([]);
  expect(record.baseline.omissions).toEqual([]);
  expect(record.omissions).toContainEqual({
    scope: 'baseline',
    field: '*',
    reason: 'no_baseline',
  });
  expect(record.omissions.some(({ scope }) => scope === 'tool_surface')).toBe(
    false,
  );
});

it('merges independent field proofs without reporting proved fields as omissions', () => {
  const proof = {
    runId: '33333333-3333-4333-8333-333333333333',
    attemptId: '44444444-4444-4444-8444-444444444444',
    promptHash: 'a'.repeat(64),
  };

  const record = buildRecencyDigestExportRecord({
    ownerId: 'owner-1',
    chat: chat(),
    attempts: attempts({
      matchedReceipt: true,
      matchedRun: { runId: proof.runId, attemptId: proof.attemptId },
      proofCandidates: [
        {
          list: 'recent',
          index: 0,
          fields: { title: 'Private title' },
          proofs: { title: proof },
        },
        {
          list: 'recent',
          index: 0,
          fields: { date: '2026-11-23' },
          proofs: { date: proof },
        },
      ],
      provenScalars: { compiledOn: '2026-11-23' },
      scalarProofs: { compiledOn: proof },
    }),
  });

  expect(record.baseline.entries.map(({ fields }) => fields)).toEqual([
    { title: 'Private title', date: '2026-11-23' },
  ]);
  expect(record.baseline.omissions.map(({ field }) => field)).toEqual([
    'messageCount',
    'excerpt',
  ]);
  expect(record.omissions.some(({ field }) => field === 'compiledOn')).toBe(
    false,
  );
  expect(
    record.omissions.some(
      ({ scope, field }) => scope === 'baseline' && field === '*',
    ),
  ).toBe(false);
  expect(JSON.stringify(record)).not.toContain('Private excerpt');
});
