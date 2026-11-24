import {
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { canonicalJson, hashWithDomain } from '../canonical-json';
import { renderSystemPromptTemplate } from '../instance-config/prompt-loader';
import type {
  PromptChatsDisclosure,
  PromptChatsFieldDisclosure,
  PromptChatsInput,
} from '../models/model-catalog';
import type { RunEvent } from '../db/schema';
import {
  hasDispatchedModelRequest,
  mapEmittedTitlesToToldEntries,
  mergeProvenDigestEntries,
  proveRenderedDigestFields,
  recencyDigestFingerprint,
  SYSTEM_PROMPT_RECEIPT_DOMAIN,
  type RecencyDigestExportDocument,
} from './recency-digest-export-proof';
import { writePrivateExportDocument } from './recency-digest-export';

const chats: PromptChatsInput = {
  pinned: [],
  recent: [
    {
      title: 'Safe title',
      date: '2026-11-23',
      messageCount: 2,
      excerpt: 'private excerpt',
    },
  ],
  pinnedShown: 0,
  pinnedTotal: 0,
  recentShown: 1,
  recentTotal: 1,
  compiledOn: '2026-11-23',
};

const disclosure: PromptChatsDisclosure = {
  pinned: new Set(),
  recent: new Set([0]),
};

const fields: PromptChatsFieldDisclosure = {
  pinned: new Map(),
  recent: new Map([[0, new Map([['title', 'Safe title']])]]),
  scalars: new Map(),
};

const text = 'A prompt with a rendered title.';
const promptHash = hashWithDomain(SYSTEM_PROMPT_RECEIPT_DOMAIN, text);

it('requires the exact receipt attempt to have a model.requested event before proving fields', async () => {
  const dispatchedByAttempt = new Map<string, Array<RunEvent>>([
    [
      'attempt-B',
      [
        {
          sequence: 9,
          runId: 'run-1',
          eventType: 'model.requested',
          payload: { attemptId: 'attempt-B' },
          createdAt: new Date(),
        },
      ],
    ],
  ]);

  const calls: Array<{
    runId: string;
    ownerId: string;
    options: {
      eventTypes: ReadonlyArray<string>;
      attemptId?: string;
      limit?: number;
    };
  }> = [];

  const events = {
    listByRunId(
      runId: string,
      ownerId: string,
      options?: {
        afterSequence?: number;
        eventTypes?: ReadonlyArray<string>;
        attemptId?: string;
        limit?: number;
      },
    ) {
      calls.push({
        runId,
        ownerId,
        options: {
          eventTypes: options?.eventTypes ?? [],
          attemptId: options?.attemptId,
          limit: options?.limit,
        },
      });

      return Promise.resolve(
        dispatchedByAttempt.get(options?.attemptId ?? '') ?? [],
      );
    },
  } satisfies {
    listByRunId: (
      runId: string,
      ownerId: string,
      options?: {
        afterSequence?: number;
        eventTypes?: ReadonlyArray<string>;
        attemptId?: string;
        limit?: number;
      },
    ) => Promise<Array<RunEvent>>;
  };

  const rendered = renderSystemPromptTemplate({
    template: '{{#each chats.recent}}{{title}}{{/each}}',
    model: { id: 'm' },
    anchor: { systemTime: '2026-11-23T00:00:00Z', systemTimezone: 'UTC' },
    chats,
    captureChatsFieldDisclosure: true,
  });

  const renderHash = hashWithDomain(
    SYSTEM_PROMPT_RECEIPT_DOMAIN,
    rendered.text,
  );

  const receipt = {
    systemPrompt: rendered.text,
    promptHash: renderHash,
    runId: 'run-1',
    attemptId: 'attempt-A',
  };

  const proveIfDispatched = async () => {
    if (
      !(await hasDispatchedModelRequest({
        events,
        runId: 'run-1',
        ownerId: 'owner-1',
        attemptId: receipt.attemptId,
      }))
    ) {
      return { pinned: [], recent: [] };
    }

    return proveRenderedDigestFields({
      renderedText: rendered.text,
      expectedPromptHash: renderHash,
      receipt,
      chats,
      disclosure: rendered.chatsDisclosure,
      fields: rendered.chatsFieldDisclosure!,
    });
  };

  expect((await proveIfDispatched()).recent).toEqual([]);
  dispatchedByAttempt.set('attempt-A', [
    {
      sequence: 10,
      runId: 'run-1',
      eventType: 'model.requested',
      payload: { attemptId: 'attempt-A' },
      createdAt: new Date(),
    },
  ]);
  expect((await proveIfDispatched()).recent).toMatchObject([
    { fields: { title: 'Safe title' } },
  ]);
  expect(calls.map(({ options }) => options)).toEqual([
    { eventTypes: ['model.requested'], attemptId: 'attempt-A', limit: 1 },
    { eventTypes: ['model.requested'], attemptId: 'attempt-A', limit: 1 },
  ]);
});

it('exports only actually emitted fields after exact rendered receipt proof', () => {
  const rendered = renderSystemPromptTemplate({
    template: '{{#each chats.recent}}{{title}}{{#if excerpt}}{{/if}}{{/each}}',
    model: { id: 'm' },
    anchor: { systemTime: '2026-11-23T00:00:00Z', systemTimezone: 'UTC' },
    chats,
    captureChatsFieldDisclosure: true,
  });

  const renderHash = hashWithDomain(
    SYSTEM_PROMPT_RECEIPT_DOMAIN,
    rendered.text,
  );

  const result = proveRenderedDigestFields({
    renderedText: rendered.text,
    expectedPromptHash: renderHash,
    receipt: {
      systemPrompt: rendered.text,
      promptHash: renderHash,
      runId: 'run-1',
      attemptId: 'attempt-1',
    },
    chats,
    disclosure: rendered.chatsDisclosure,
    fields: rendered.chatsFieldDisclosure!,
  });

  expect(result.recent).toEqual([
    {
      list: 'recent',
      index: 0,
      fields: { title: 'Safe title' },
      proofs: {
        title: {
          runId: 'run-1',
          attemptId: 'attempt-1',
          promptHash: renderHash,
        },
      },
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('private excerpt');
});

it('proves partial fields from distinct rendered templates without duplicate row identity', () => {
  const renderProof = (template: string, runId: string) => {
    const rendered = renderSystemPromptTemplate({
      template,
      model: { id: 'm' },
      anchor: { systemTime: '2026-11-23T00:00:00Z', systemTimezone: 'UTC' },
      chats,
      captureChatsFieldDisclosure: true,
    });

    const renderHash = hashWithDomain(
      SYSTEM_PROMPT_RECEIPT_DOMAIN,
      rendered.text,
    );

    return proveRenderedDigestFields({
      renderedText: rendered.text,
      expectedPromptHash: renderHash,
      receipt: {
        systemPrompt: rendered.text,
        promptHash: renderHash,
        runId,
        attemptId: `${runId}-attempt`,
      },
      chats,
      disclosure: rendered.chatsDisclosure,
      fields: rendered.chatsFieldDisclosure!,
    });
  };

  const titleProof = renderProof(
    '{{#each chats.recent}}{{title}}{{/each}}',
    'run-title',
  );

  const excerptProof = renderProof(
    '{{#each chats.recent}}{{excerpt}}{{/each}}',
    'run-excerpt',
  );

  const repeatedProof = renderProof(
    '{{#each chats.recent}}{{title}}{{/each}}',
    'run-title',
  );

  const merged = mergeProvenDigestEntries([
    ...titleProof.recent,
    ...excerptProof.recent,
    ...repeatedProof.recent,
  ]);

  expect(merged).toHaveLength(1);
  expect(merged[0].fields).toEqual({
    title: 'Safe title',
    excerpt: 'private excerpt',
  });
  expect(merged[0].proofs.title).toEqual(titleProof.recent[0].proofs.title);
  expect(merged[0].proofs.excerpt).toEqual(
    excerptProof.recent[0].proofs.excerpt,
  );
  expect(repeatedProof.recent).toEqual(titleProof.recent);
});

it('omits all fields when the stored receipt is absent or changed', () => {
  const absent = proveRenderedDigestFields({
    renderedText: text,
    expectedPromptHash: promptHash,
    chats,
    disclosure,
    fields,
  });

  expect(absent).toEqual({ pinned: [], recent: [], reason: 'no_receipt' });

  const changed = proveRenderedDigestFields({
    renderedText: text,
    expectedPromptHash: promptHash,
    receipt: {
      systemPrompt: 'a different prompt',
      promptHash,
      runId: 'run-1',
      attemptId: 'attempt-1',
    },
    chats,
    disclosure,
    fields,
  });

  expect(changed).toEqual({
    pinned: [],
    recent: [],
    reason: 'receipt_mismatch',
  });
});

it('does not map duplicate emitted titles to an ambiguous told id', () => {
  expect(
    mapEmittedTitlesToToldEntries({
      emittedTitles: ['Same title'],
      told: [
        { chatId: 'chat-1', pinned: true, title: 'Same title' },
        { chatId: 'chat-2', pinned: false, title: 'Same title' },
      ],
    }),
  ).toEqual({
    entries: [],
    omissions: [{ field: 'identity', reason: 'duplicate_title' }],
  });
});

it('rejects told titles that collide after prompt sanitization', () => {
  expect(
    mapEmittedTitlesToToldEntries({
      emittedTitles: ['&lt;/x&gt;'],
      told: [
        { chatId: 'chat-1', pinned: true, title: '</x>' },
        { chatId: 'chat-2', pinned: false, title: '&lt;/x&gt;' },
      ],
    }),
  ).toEqual({
    entries: [],
    omissions: [{ field: 'identity', reason: 'duplicate_title' }],
  });
});

it('maps proved titles and leaves untitled legacy told entries unproved', () => {
  expect(
    mapEmittedTitlesToToldEntries({
      emittedTitles: ['Safe title'],
      told: [
        { chatId: 'chat-legacy', pinned: true },
        { chatId: 'chat-1', pinned: false, title: 'Safe title' },
        { chatId: 'chat-blank', pinned: false, title: '   ' },
      ],
    }),
  ).toEqual({
    entries: [{ chatId: 'chat-1', pinned: false, title: 'Safe title' }],
    omissions: [],
  });
});

it('fingerprints only the three old columns with canonical key order', () => {
  const columns = {
    baseline: {
      pinned: [],
      recent: [],
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 0,
      recentTotal: 0,
      compiledOn: '2026-11-23',
    },
    told: [],
    rebakedFrom: null,
  };

  expect(recencyDigestFingerprint(columns)).toBe(
    hashWithDomain('llame:recency-digest:export:v1', canonicalJson(columns)),
  );
  expect(
    recencyDigestFingerprint({
      ...columns,
      told: [{ chatId: 'id', pinned: true }],
    }),
  ).not.toBe(recencyDigestFingerprint(columns));
});

it('creates an exclusive private file and preserves existing files and symlinks', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'recency-digest-export-'));
  const outputPath = path.join(directory, 'export.json');

  const document: RecencyDigestExportDocument = {
    version: 1,
    exporter: 'recency-digest-export/1',
    exportedAt: '2026-11-23T00:00:00.000Z',
    records: [],
  };

  writePrivateExportDocument(outputPath, document);
  const textOutput = readFileSync(outputPath, 'utf8');
  expect(statSync(outputPath).mode & 0o777).toBe(0o600);
  expect(textOutput).toContain('"records":[]');
  expect(textOutput).not.toContain('systemPrompt');
  expect(textOutput).not.toContain('secret-token');
  expect(() => writePrivateExportDocument(outputPath, document)).toThrow(
    /EEXIST/,
  );
  expect(readFileSync(outputPath, 'utf8')).toBe(textOutput);

  const targetPath = path.join(directory, 'target.json');
  const linkPath = path.join(directory, 'link.json');
  writeFileSync(targetPath, 'unchanged target');
  symlinkSync(targetPath, linkPath);
  expect(() => writePrivateExportDocument(linkPath, document)).toThrow(
    /EEXIST/,
  );
  expect(readFileSync(targetPath, 'utf8')).toBe('unchanged target');
});
