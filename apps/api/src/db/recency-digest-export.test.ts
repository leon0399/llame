import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { canonicalJson, hashWithDomain } from '../canonical-json';
import {
  digestColumnsFingerprint,
  parseDigestExportDocument,
  type DigestExportDocument,
} from './recency-digest-export';

const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const checkpointId = '33333333-3333-4333-8333-333333333333';
const chatId = '44444444-4444-4444-8444-444444444444';
const sourceChatId = '55555555-5555-4555-8555-555555555555';
const noticeId = '66666666-6666-4666-8666-666666666666';
const promptHash = '0123456789abcdef'.repeat(4);

const proof = { runId, attemptId, promptHash };

function validDocument(): DigestExportDocument {
  return {
    version: 1,
    exporter: 'recency-digest-export/1',
    exportedAt: '2026-11-23T14:30:00.000Z',
    records: [
      {
        ownerUserId: 'owner-123',
        chatId,
        fingerprint: 'fedcba9876543210'.repeat(4),
        baseline: {
          compiledOn: '2026-11-20T12:00:00.000Z',
          pinnedShown: 1,
          pinnedTotal: 2,
          recentShown: 3,
          recentTotal: 10,
          scalarProofs: {
            compiledOn: proof,
            pinnedShown: proof,
            pinnedTotal: proof,
            recentShown: proof,
            recentTotal: proof,
          },
          entries: [
            {
              list: 'pinned',
              index: 0,
              fields: {
                title: 'Planning notes',
                date: '2026-11-18T10:00:00.000Z',
                messageCount: 8,
                excerpt: 'Reviewed the rollout plan.',
              },
              proofs: {
                title: proof,
                date: proof,
                messageCount: proof,
                excerpt: proof,
              },
            },
          ],
          omissions: [
            {
              list: 'recent',
              index: 2,
              field: 'excerpt',
              reason: 'not_proven',
            },
          ],
        },
        comparison: {
          entries: [
            {
              chatId: sourceChatId,
              pinned: true,
              title: 'Planning notes',
              proofs: {
                identity: proof,
                pin: { kind: 'baseline', proof },
              },
            },
            {
              chatId: noticeId,
              pinned: false,
              title: 'Release checklist',
              proofs: {
                identity: proof,
                pin: { kind: 'notice', messageId: noticeId },
              },
            },
          ],
          omissions: [
            { chatId: sourceChatId, field: 'workspace', reason: 'not_proven' },
            { field: 'title', reason: 'legacy_value_missing' },
          ],
        },
        provenance: {
          originalRun: runId,
          attemptId,
          activeCheckpointId: checkpointId,
          latestPreTurn: { runId, seq: 7 },
          lastOriginalSeq: 9,
        },
        omissions: [
          { scope: 'baseline', field: 'workspace', reason: 'not_exported' },
        ],
      },
    ],
  };
}

describe('parseDigestExportDocument', () => {
  it('accepts complete evidence at the safe integer boundary', () => {
    const document = validDocument();
    expect(parseDigestExportDocument(document)).toEqual(document);
    const record = document.records[0];

    for (const field of [
      'pinnedShown',
      'pinnedTotal',
      'recentShown',
      'recentTotal',
    ] as const)
      record.baseline[field] = Number.MAX_SAFE_INTEGER;
    record.baseline.entries[0].index = Number.MAX_SAFE_INTEGER;
    record.baseline.entries[0].fields.messageCount = Number.MAX_SAFE_INTEGER;
    record.baseline.omissions[0].index = Number.MAX_SAFE_INTEGER;
    record.provenance.latestPreTurn = { runId, seq: Number.MAX_SAFE_INTEGER };
    record.provenance.lastOriginalSeq = Number.MAX_SAFE_INTEGER;

    const offsetTimestamp = {
      ...document,
      exportedAt: '2026-11-23T14:30:00.000+02:00',
    };

    expect(parseDigestExportDocument(offsetTimestamp).exportedAt).toBe(
      offsetTimestamp.exportedAt,
    );
    expect(parseDigestExportDocument(document)).toEqual(document);
  });

  it('rejects unsupported envelope versions, exporters, timestamps, and list names', () => {
    const document = validDocument();

    for (const invalid of [
      { ...document, version: 2 },
      { ...document, exporter: 'recency-digest-export/2' },
      { ...document, exportedAt: 'not-a-date' },
      { ...document, unexpected: true },
    ])
      expect(() => parseDigestExportDocument(invalid)).toThrow(ZodError);
    const record = document.records[0];
    expect(() =>
      parseDigestExportDocument({
        ...document,
        records: [
          {
            ...record,
            baseline: {
              ...record.baseline,
              entries: [{ ...record.baseline.entries[0], list: 'archived' }],
            },
          },
        ],
      }),
    ).toThrow(ZodError);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid counters, indices, and history sequences: %s',
    (invalid) => {
      const document = validDocument();
      const record = document.records[0];

      for (const field of [
        'pinnedShown',
        'pinnedTotal',
        'recentShown',
        'recentTotal',
      ] as const)
        expect(() =>
          parseDigestExportDocument({
            ...document,
            records: [
              { ...record, baseline: { ...record.baseline, [field]: invalid } },
            ],
          }),
        ).toThrow(ZodError);
      const entry = record.baseline.entries[0];

      for (const baseline of [
        { ...record.baseline, entries: [{ ...entry, index: invalid }] },
        {
          ...record.baseline,
          entries: [
            { ...entry, fields: { ...entry.fields, messageCount: invalid } },
          ],
        },
        {
          ...record.baseline,
          omissions: [{ ...record.baseline.omissions[0], index: invalid }],
        },
      ])
        expect(() =>
          parseDigestExportDocument({
            ...document,
            records: [{ ...record, baseline }],
          }),
        ).toThrow(ZodError);
      expect(() =>
        parseDigestExportDocument({
          ...document,
          records: [
            {
              ...record,
              provenance: {
                ...record.provenance,
                lastOriginalSeq: invalid,
                latestPreTurn: null,
              },
            },
          ],
        }),
      ).toThrow(ZodError);

      try {
        parseDigestExportDocument({
          ...document,
          records: [
            {
              ...record,
              provenance: {
                ...record.provenance,
                latestPreTurn: { runId, seq: invalid },
              },
            },
          ],
        });
        expect.fail('Invalid numeric sequence was admitted');
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        const issue = error.issues.find(({ code }) => code !== 'custom');
        expect(issue).toMatchObject({
          code:
            invalid === 1.5
              ? 'invalid_type'
              : invalid < 0
                ? 'too_small'
                : 'too_big',
          path: ['records', 0, 'provenance', 'latestPreTurn', 'seq'],
        });
      }
    },
  );

  it('rejects a nonpositive pre-turn sequence and a trigger beyond the history cutoff', () => {
    const document = validDocument();
    const record = document.records[0];

    for (const provenance of [
      { ...record.provenance, latestPreTurn: { runId, seq: 0 } },
      { ...record.provenance, lastOriginalSeq: 6 },
    ])
      expect(() =>
        parseDigestExportDocument({
          ...document,
          records: [{ ...record, provenance }],
        }),
      ).toThrow(ZodError);
  });

  it('rejects partial, non-hex, uppercase, and unanchored fingerprints and receipt hashes', () => {
    const document = validDocument();
    const record = document.records[0];

    for (const hash of [
      'a'.repeat(63),
      'a'.repeat(65),
      `${'a'.repeat(64)}!`,
      `!${'a'.repeat(64)}`,
      'A'.repeat(64),
      'g'.repeat(64),
    ]) {
      expect(() =>
        parseDigestExportDocument({
          ...document,
          records: [{ ...record, fingerprint: hash }],
        }),
      ).toThrow(ZodError);
      expect(() =>
        parseDigestExportDocument({
          ...document,
          records: [
            {
              ...record,
              baseline: {
                ...record.baseline,
                scalarProofs: {
                  ...record.baseline.scalarProofs,
                  pinnedShown: { ...proof, promptHash: hash },
                },
              },
            },
          ],
        }),
      ).toThrow(ZodError);
    }
  });

  it('rejects invalid and duplicate identities and unpaired Run provenance', () => {
    const document = validDocument();
    const record = document.records[0];

    for (const invalid of [
      { ...record, chatId: 'not-a-uuid' },
      {
        ...record,
        provenance: { ...record.provenance, originalRun: 'not-a-uuid' },
      },
      { ...record, provenance: { ...record.provenance, originalRun: null } },
      { ...record, provenance: { ...record.provenance, attemptId: null } },
      {
        ...record,
        comparison: {
          ...record.comparison,
          entries: [{ ...record.comparison.entries[0], chatId: 'not-a-uuid' }],
        },
      },
      {
        ...record,
        comparison: {
          ...record.comparison,
          entries: [record.comparison.entries[0], record.comparison.entries[0]],
        },
      },
      {
        ...record,
        baseline: {
          ...record.baseline,
          scalarProofs: {
            ...record.baseline.scalarProofs,
            compiledOn: { ...proof, attemptId: 'not-a-uuid' },
          },
        },
      },
    ])
      expect(() =>
        parseDigestExportDocument({
          ...document,
          records: [invalid],
        }),
      ).toThrow(ZodError);
  });

  it('rejects extra persisted fields and unsupported proof keys at each evidence boundary', () => {
    const document = validDocument();
    const record = document.records[0];
    const entry = record.baseline.entries[0];
    const comparison = record.comparison.entries[0];

    for (const invalid of [
      { ...record, unexpected: true },
      { ...record, baseline: { ...record.baseline, unexpected: true } },
      {
        ...record,
        baseline: { ...record.baseline, scalarProofs: { unexpected: proof } },
      },
      {
        ...record,
        baseline: {
          ...record.baseline,
          entries: [{ ...entry, unexpected: true }],
        },
      },
      {
        ...record,
        baseline: {
          ...record.baseline,
          entries: [
            { ...entry, fields: { ...entry.fields, unexpected: true } },
          ],
        },
      },
      {
        ...record,
        baseline: {
          ...record.baseline,
          entries: [
            { ...entry, proofs: { ...entry.proofs, workspace: proof } },
          ],
        },
      },
      {
        ...record,
        baseline: {
          ...record.baseline,
          entries: [
            {
              ...entry,
              proofs: {
                ...entry.proofs,
                title: { ...proof, unexpected: true },
              },
            },
          ],
        },
      },
      {
        ...record,
        baseline: {
          ...record.baseline,
          omissions: [{ ...record.baseline.omissions[0], unexpected: true }],
        },
      },
      { ...record, comparison: { ...record.comparison, unexpected: true } },
      {
        ...record,
        comparison: {
          ...record.comparison,
          entries: [{ ...comparison, unexpected: true }],
        },
      },
      {
        ...record,
        comparison: {
          ...record.comparison,
          entries: [
            {
              ...comparison,
              proofs: { ...comparison.proofs, unexpected: true },
            },
          ],
        },
      },
      {
        ...record,
        comparison: {
          ...record.comparison,
          entries: [
            {
              ...comparison,
              proofs: {
                ...comparison.proofs,
                pin: { kind: 'baseline', proof, unexpected: true },
              },
            },
          ],
        },
      },
      {
        ...record,
        comparison: {
          ...record.comparison,
          entries: [
            {
              ...comparison,
              proofs: {
                ...comparison.proofs,
                pin: { kind: 'notice', messageId: noticeId, unexpected: true },
              },
            },
          ],
        },
      },
      {
        ...record,
        comparison: {
          ...record.comparison,
          omissions: [{ ...record.comparison.omissions[0], unexpected: true }],
        },
      },
      { ...record, provenance: { ...record.provenance, unexpected: true } },
      {
        ...record,
        provenance: {
          ...record.provenance,
          latestPreTurn: { runId, seq: 7, unexpected: true },
        },
      },
      { ...record, omissions: [{ ...record.omissions[0], unexpected: true }] },
    ])
      expect(() =>
        parseDigestExportDocument({
          ...document,
          records: [invalid],
        }),
      ).toThrow(ZodError);
  });

  it('accepts empty optional disclosures and paired null Run provenance', () => {
    const empty = validDocument();
    empty.records[0].baseline = { entries: [], omissions: [] };
    empty.records[0].comparison = { entries: [], omissions: [] };
    empty.records[0].provenance = {
      originalRun: null,
      attemptId: null,
      activeCheckpointId: null,
      latestPreTurn: null,
      lastOriginalSeq: 0,
    };
    expect(parseDigestExportDocument(empty)).toEqual(empty);
  });
});

describe('digestColumnsFingerprint', () => {
  it('fingerprints canonical legacy-column data with domain separation', () => {
    const columns = {
      baseline: { compiledOn: '2026-11-20T12:00:00.000Z', recentTotal: 10 },
      told: [{ chatId: sourceChatId, title: 'Planning notes' }],
      rebakedFrom: runId,
    };

    const fingerprint = digestColumnsFingerprint(columns);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(
      digestColumnsFingerprint({
        rebakedFrom: runId,
        told: [{ title: 'Planning notes', chatId: sourceChatId }],
        baseline: { recentTotal: 10, compiledOn: '2026-11-20T12:00:00.000Z' },
      }),
    ).toBe(fingerprint);
    expect(
      digestColumnsFingerprint({ ...columns, baseline: { recentTotal: 11 } }),
    ).not.toBe(fingerprint);
    expect(digestColumnsFingerprint({ ...columns, told: [] })).not.toBe(
      fingerprint,
    );
    expect(
      digestColumnsFingerprint({ ...columns, rebakedFrom: null }),
    ).not.toBe(fingerprint);
    expect(fingerprint).toBe(
      hashWithDomain('llame:recency-digest:export:v1', canonicalJson(columns)),
    );
  });
});
