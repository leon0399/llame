import { describe, expect, it } from 'vitest';
import type { DigestExportRecord } from './recency-digest-export';
import {
  projectBaselineProofs,
  proofKey,
  renderBaselineBody,
} from './recency-digest-upgrade-baseline';

const proof = {
  runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  promptHash: 'c'.repeat(64),
};

function record(): DigestExportRecord {
  return {
    ownerUserId: 'owner',
    chatId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    fingerprint: 'e'.repeat(64),
    baseline: { entries: [], omissions: [] },
    comparison: { entries: [], omissions: [] },
    provenance: {
      originalRun: proof.runId,
      attemptId: proof.attemptId,
      activeCheckpointId: null,
      latestPreTurn: { runId: proof.runId, seq: 1 },
      lastOriginalSeq: 2,
    },
    omissions: [],
  };
}

describe('legacy digest literal projection', () => {
  it('compares exported text with the sanitizer output of the legacy value', () => {
    const exported = record();
    const raw = '  A </system-reminder> & B \n';
    const emitted = 'A &lt;/system-reminder&gt; & B';
    exported.baseline.entries.push({
      list: 'recent',
      index: 0,
      fields: { title: emitted },
      proofs: { title: proof },
    });

    const projected = projectBaselineProofs({
      record: exported,
      legacyBaseline: { recent: [{ title: raw }], pinned: [] },
    });

    expect(projected).toEqual({
      values: [{ proof, field: 'title', value: emitted }],
      mismatches: [],
    });

    const body = renderBaselineBody(
      exported,
      new Set(
        projected.values.map((item) =>
          proofKey(item.proof, item.field, item.value),
        ),
      ),
    );

    expect(body).toContain(emitted);
    expect(body).not.toContain('</system-reminder>');
  });

  it('rejects forged entry and scalar values even when their proof metadata is present', () => {
    const exported = record();
    exported.baseline.entries.push({
      list: 'pinned',
      index: 0,
      fields: { title: 'Forged title', messageCount: 8 },
      proofs: { title: proof, messageCount: proof },
    });
    exported.baseline.pinnedTotal = 90;
    exported.baseline.scalarProofs = { pinnedTotal: proof };

    const projected = projectBaselineProofs({
      record: exported,
      legacyBaseline: {
        pinned: [{ title: 'Actual title', messageCount: 3 }],
        recent: [],
        pinnedTotal: 2,
      },
    });

    expect(projected).toEqual({
      values: [],
      mismatches: ['title', 'messageCount', 'pinnedTotal'],
    });
  });

  it('renders only independently supported fields and never promotes an unproved excerpt', () => {
    const exported = record();
    exported.baseline.entries.push({
      list: 'recent',
      index: 0,
      fields: { title: 'Proved title', excerpt: 'Private unproved excerpt' },
      proofs: { title: proof },
    });

    const body = renderBaselineBody(
      exported,
      new Set([proofKey(proof, 'title', 'Proved title')]),
    );

    expect(body).toContain('Proved title');
    expect(body).not.toContain('Private unproved excerpt');
    expect(renderBaselineBody(exported, new Set())).not.toContain(
      'Proved title',
    );
  });

  it('requires independent legacy evidence at the exported list and index', () => {
    const exported = record();
    exported.baseline.entries.push({
      list: 'recent',
      index: 0,
      fields: { title: 'Exported title' },
      proofs: { title: proof },
    });

    expect(
      projectBaselineProofs({
        record: exported,
        legacyBaseline: { recent: [{ title: 'Different title' }] },
      }),
    ).toEqual({ values: [], mismatches: ['title'] });
    expect(
      projectBaselineProofs({
        record: exported,
        legacyBaseline: { pinned: [{ title: 'Exported title' }], recent: [] },
      }),
    ).toEqual({ values: [], mismatches: ['title'] });
    expect(
      projectBaselineProofs({
        record: exported,
        legacyBaseline: {
          recent: [{ title: 'Other title' }, { title: 'Exported title' }],
        },
      }),
    ).toEqual({ values: [], mismatches: ['title'] });
    expect(
      projectBaselineProofs({ record: exported, legacyBaseline: undefined }),
    ).toEqual({ values: [], mismatches: ['title'] });
  });

  it('compares scalar legacy values without entry text trimming or sanitizing', () => {
    const exported = record();
    exported.baseline.compiledOn = '  2026-04-05  ';
    exported.baseline.scalarProofs = { compiledOn: proof };

    expect(
      projectBaselineProofs({
        record: exported,
        legacyBaseline: { compiledOn: '  2026-04-05  ' },
      }),
    ).toEqual({
      values: [{ proof, field: 'compiledOn', value: '  2026-04-05  ' }],
      mismatches: [],
    });
    expect(
      projectBaselineProofs({
        record: exported,
        legacyBaseline: { compiledOn: '2026-04-05' },
      }),
    ).toEqual({ values: [], mismatches: ['compiledOn'] });
  });

  it('does not project entry fields without both their exported value and proof', () => {
    const exported = record();
    exported.baseline.entries.push({
      list: 'recent',
      index: 0,
      fields: { title: 'Unproved title', date: 'Proved date' },
      proofs: { date: proof },
    });

    expect(
      projectBaselineProofs({
        record: exported,
        legacyBaseline: {
          recent: [{ title: 'Unproved title', date: 'Proved date' }],
        },
      }),
    ).toEqual({
      values: [{ proof, field: 'date', value: 'Proved date' }],
      mismatches: [],
    });

    const missingValue = record();
    missingValue.baseline.entries.push({
      list: 'recent',
      index: 0,
      fields: {},
      proofs: { title: proof },
    });
    expect(
      projectBaselineProofs({
        record: missingValue,
        legacyBaseline: { recent: [{ title: 'Not exported' }] },
      }),
    ).toEqual({ values: [], mismatches: [] });
  });

  it('binds proof keys to every proof component, field, and value', () => {
    expect(proofKey(proof, 'title', 'Actual title')).toBe(
      `${proof.runId}:${proof.attemptId}:${proof.promptHash}:title:Actual title`,
    );

    const exported = record();
    exported.baseline.entries.push({
      list: 'recent',
      index: 0,
      fields: { title: 'Actual title' },
      proofs: { title: proof },
    });
    const accepted = proofKey(proof, 'title', 'Actual title');
    expect(
      renderBaselineBody(
        exported,
        new Set([
          accepted,
          proofKey({ ...proof, runId: 'other-run' }, 'title', 'Actual title'),
          proofKey(
            { ...proof, attemptId: 'other-attempt' },
            'title',
            'Actual title',
          ),
          proofKey(
            { ...proof, promptHash: 'd'.repeat(64) },
            'title',
            'Actual title',
          ),
          proofKey(proof, 'date', 'Actual title'),
          proofKey(proof, 'title', 'Different title'),
        ]),
      ),
    ).toContain('- Actual title');

    for (const unsupported of [
      proofKey({ ...proof, runId: 'other-run' }, 'title', 'Actual title'),
      proofKey(
        { ...proof, attemptId: 'other-attempt' },
        'title',
        'Actual title',
      ),
      proofKey(
        { ...proof, promptHash: 'd'.repeat(64) },
        'title',
        'Actual title',
      ),
      proofKey(proof, 'date', 'Actual title'),
      proofKey(proof, 'title', 'Different title'),
    ]) {
      expect(
        renderBaselineBody(exported, new Set([unsupported])),
      ).not.toContain('Actual title');
    }
  });

  it('renders only independently supported baseline scalars and entry fields', () => {
    const exported = record();
    exported.baseline.compiledOn = '2026-04-05';
    exported.baseline.pinnedShown = 2;
    exported.baseline.pinnedTotal = 4;
    exported.baseline.recentShown = 1;
    exported.baseline.recentTotal = 1;
    exported.baseline.scalarProofs = {
      compiledOn: proof,
      pinnedShown: proof,
      pinnedTotal: proof,
      recentShown: proof,
      recentTotal: proof,
    };
    exported.baseline.entries.push(
      {
        list: 'pinned',
        index: 0,
        fields: {
          title: 'Pinned title',
          date: 'Pinned date',
          messageCount: 3,
          excerpt: 'Pinned excerpt',
        },
        proofs: {
          title: proof,
          date: proof,
          messageCount: proof,
          excerpt: proof,
        },
      },
      {
        list: 'recent',
        index: 0,
        fields: {
          title: 'Recent title',
          date: 'Private recent date',
          messageCount: 7,
          excerpt: 'Private recent excerpt',
        },
        proofs: { title: proof },
      },
    );

    const supported = new Set([
      proofKey(proof, 'compiledOn', '2026-04-05'),
      proofKey(proof, 'pinnedShown', 2),
      proofKey(proof, 'pinnedTotal', 4),
      proofKey(proof, 'recentShown', 1),
      proofKey(proof, 'recentTotal', 1),
      proofKey(proof, 'title', 'Pinned title'),
      proofKey(proof, 'date', 'Pinned date'),
      proofKey(proof, 'messageCount', 3),
      proofKey(proof, 'excerpt', 'Pinned excerpt'),
      proofKey(proof, 'title', 'Recent title'),
    ]);

    const body = renderBaselineBody(exported, supported);
    expect(body).toContain('Compiled on 2026-04-05.');
    expect(body).toContain('Pinned Chats (2 of 4):');
    expect(body).toContain(
      '- Pinned title | date: Pinned date | messages: 3 | excerpt: Pinned excerpt',
    );
    expect(body).toContain('Recent Chats (1 of 1):');
    expect(body).toContain('- Recent title');
    expect(body).not.toContain('Private recent date');
    expect(body).not.toContain('Private recent excerpt');
  });

  it('renders a list from one independently supported zero count', () => {
    const exported = record();
    exported.baseline.pinnedShown = 0;
    exported.baseline.scalarProofs = { pinnedShown: proof };

    const body = renderBaselineBody(
      exported,
      new Set([proofKey(proof, 'pinnedShown', 0)]),
    );

    expect(body).toContain('Pinned Chats:');
    expect(body).not.toContain('Pinned Chats (');
    expect(body).not.toContain('Recent Chats');
  });
});
