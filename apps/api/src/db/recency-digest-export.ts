import { z } from 'zod';
import { canonicalJson, hashWithDomain } from '../canonical-json';

export const RECENCY_DIGEST_EXPORT_VERSION = 1 as const;
export const RECENCY_DIGEST_EXPORTER = 'recency-digest-export/1' as const;
export const RECENCY_DIGEST_EXPORT_DOMAIN = 'llame:recency-digest:export:v1';

const proof = z
  .object({
    runId: z.string().uuid(),
    attemptId: z.string().uuid(),
    promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const scalarProofKeys = [
  'compiledOn',
  'pinnedShown',
  'pinnedTotal',
  'recentShown',
  'recentTotal',
];

const entryProofKeys = ['title', 'date', 'messageCount', 'excerpt'];

const scalarProof = z
  .record(z.string(), proof)
  .superRefine((value, context) => {
    for (const key of Object.keys(value))
      if (!scalarProofKeys.includes(key))
        context.addIssue({
          code: 'custom',
          message: 'Invalid scalar proof key',
          path: [key],
        });
  });

const entryProof = z.record(z.string(), proof).superRefine((value, context) => {
  for (const key of Object.keys(value))
    if (!entryProofKeys.includes(key))
      context.addIssue({
        code: 'custom',
        message: 'Invalid entry proof key',
        path: [key],
      });
});

const record = z
  .object({
    ownerUserId: z.string().min(1),
    chatId: z.string().uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    baseline: z
      .object({
        compiledOn: z.string().optional(),
        pinnedShown: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
        pinnedTotal: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
        recentShown: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
        recentTotal: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
        scalarProofs: scalarProof.optional(),
        entries: z.array(
          z
            .object({
              list: z.enum(['pinned', 'recent']),
              index: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
              fields: z
                .object({
                  title: z.string().optional(),
                  date: z.string().optional(),
                  messageCount: z
                    .number()
                    .int()
                    .min(0)
                    .max(Number.MAX_SAFE_INTEGER)
                    .optional(),
                  excerpt: z.string().optional(),
                })
                .strict(),
              proofs: entryProof,
            })
            .strict(),
        ),
        omissions: z.array(
          z
            .object({
              list: z.enum(['pinned', 'recent']),
              index: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
              field: z.string(),
              reason: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
    comparison: z
      .object({
        entries: z.array(
          z
            .object({
              chatId: z.string().uuid(),
              pinned: z.boolean(),
              title: z.string(),
              proofs: z
                .object({
                  identity: proof,
                  pin: z.discriminatedUnion('kind', [
                    z.object({ kind: z.literal('baseline'), proof }).strict(),
                    z
                      .object({
                        kind: z.literal('notice'),
                        messageId: z.string().uuid(),
                      })
                      .strict(),
                  ]),
                })
                .strict(),
            })
            .strict(),
        ),
        omissions: z.array(
          z
            .object({
              chatId: z.string().uuid().optional(),
              field: z.string(),
              reason: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
    provenance: z
      .object({
        originalRun: z.string().uuid().nullable(),
        attemptId: z.string().uuid().nullable(),
        activeCheckpointId: z.string().uuid().nullable(),
        latestPreTurn: z
          .object({
            runId: z.string().uuid(),
            seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          })
          .strict()
          .nullable(),
        lastOriginalSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
    omissions: z.array(
      z
        .object({ scope: z.string(), field: z.string(), reason: z.string() })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.provenance.originalRun === null) !==
      (value.provenance.attemptId === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Original Run and attempt provenance must be paired',
        path: ['provenance'],
      });
    }

    if (
      value.provenance.latestPreTurn &&
      value.provenance.latestPreTurn.seq > value.provenance.lastOriginalSeq
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Latest pre-turn exceeds the original history cutoff',
        path: ['provenance', 'latestPreTurn', 'seq'],
      });
    }

    const comparisonChatIds = new Set<string>();

    for (const [index, entry] of value.comparison.entries.entries()) {
      if (comparisonChatIds.has(entry.chatId)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate comparison Chat identity',
          path: ['comparison', 'entries', index, 'chatId'],
        });
      }

      comparisonChatIds.add(entry.chatId);
    }
  });

export const digestExportDocument = z
  .object({
    version: z.literal(RECENCY_DIGEST_EXPORT_VERSION),
    exporter: z.literal(RECENCY_DIGEST_EXPORTER),
    exportedAt: z.string().datetime({ offset: true }),
    records: z.array(record),
  })
  .strict();

export type LegacyDigestColumns = {
  baseline: unknown;
  told: unknown;
  rebakedFrom: string | null;
};

export type DigestExportProof = z.infer<typeof proof>;

export type DigestExportRecord = z.infer<typeof record>;

export type DigestExportDocument = z.infer<typeof digestExportDocument>;

export function parseDigestExportDocument(
  value: unknown,
): DigestExportDocument {
  return digestExportDocument.parse(value);
}

export function digestColumnsFingerprint(columns: LegacyDigestColumns): string {
  return hashWithDomain(
    RECENCY_DIGEST_EXPORT_DOMAIN,
    canonicalJson({
      baseline: columns.baseline,
      told: columns.told,
      rebakedFrom: columns.rebakedFrom,
    }),
  );
}
