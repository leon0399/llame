/**
 * The two `skill-catalog` forms and the framing they carry.
 *
 * The bodies are asserted verbatim because they are model-visible text: a
 * missing sentence here is a missing instruction there.
 */

import {
  createSkillCatalogNoticeItem,
  createSkillCatalogSnapshotItem,
} from './skill-catalog-item';

const RUN_ID = '11111111-2222-4333-8444-555555555555';

const bodyOf = (part: { readonly data: { readonly text?: string } }) =>
  part.data.text ?? '';

describe('skill-catalog notice', () => {
  it('lists additions with their descriptions and removals by name', () => {
    const item = createSkillCatalogNoticeItem({
      runId: RUN_ID,
      payload: {
        kind: 'delta',
        added: [{ name: 'research', description: 'Plan an investigation' }],
        removed: ['legacy'],
      },
    });

    const body = bodyOf(item);
    expect(body).toContain('Added skills:');
    expect(body).toContain('- `research`: Plan an investigation');
    expect(body).toContain('Removed skills:');
    expect(body).toContain('- `legacy`');
  });

  it('omits the precedence line when only removals are announced', () => {
    // A removals-only delta carries no operator-authored text, so the disclaimer
    // would disclaim nothing.
    const item = createSkillCatalogNoticeItem({
      runId: RUN_ID,
      payload: { kind: 'delta', added: [], removed: ['legacy'] },
    });

    const body = bodyOf(item);
    expect(body).toContain('Removed skills:');
    expect(body).not.toContain('operator-authored catalog data');
  });
});

describe('skill-catalog snapshot', () => {
  it('says so when the catalog is empty, rather than heading an empty list', () => {
    // Reachable: a told state past the bound, then a source emptied mid-epoch.
    // "Current skills:" followed by nothing is indistinguishable from a
    // truncated render, and the precedence line would disclaim absent content.
    const item = createSkillCatalogSnapshotItem({
      runId: RUN_ID,
      payload: { kind: 'snapshot', skills: [], omitted: 0 },
    });

    const body = bodyOf(item);
    expect(body).toContain('No skills are currently available');
    expect(body).not.toContain('Current skills:');
    expect(body).not.toContain('operator-authored catalog data');
  });

  it('lists the bounded set and discloses what was left out', () => {
    const item = createSkillCatalogSnapshotItem({
      runId: RUN_ID,
      payload: {
        kind: 'snapshot',
        skills: [{ name: 'pdf', description: 'Extract text' }],
        omitted: 4,
      },
    });

    const body = bodyOf(item);
    expect(body).toContain('Current skills:');
    expect(body).toContain('- `pdf`: Extract text');
    expect(body).toContain('4 more skills are available');
    expect(body).toContain('operator-authored catalog data');
  });

  it('supersedes earlier catalog items explicitly', () => {
    const item = createSkillCatalogSnapshotItem({
      runId: RUN_ID,
      payload: {
        kind: 'snapshot',
        skills: [{ name: 'pdf', description: 'Extract text' }],
        omitted: 0,
      },
    });

    expect(bodyOf(item)).toContain('superseded');
  });
});
