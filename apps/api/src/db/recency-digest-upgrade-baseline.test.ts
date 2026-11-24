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
});
