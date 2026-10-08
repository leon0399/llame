/**
 * Guard and remainder edge cases of the `skill-activation` producer that the
 * main producer test does not reach: the import-list shape checks, the
 * remainder-count checks, and a notice kept alive by carried-forward counts.
 */

import {
  createSkillActivationOmissionItem,
  isSkillActivationPayload,
} from './skill-activation-item';

const RUN_ID = '11111111-2222-4333-8444-555555555555';

const bodyOf = (part: { readonly data: { readonly text?: string } }) =>
  part.data.text ?? '';

describe('the payload guard on import lists', () => {
  it.each([
    ['a blank entry after a valid one', ['skill://a/notes.md', ' ']],
    ['a blank entry before a valid one', [' ', 'skill://a/notes.md']],
    ['a non-string entry beside a valid one', ['skill://a/notes.md', 1]],
  ])('rejects an activation import list with %s', (_label, imports) => {
    expect(
      isSkillActivationPayload({
        kind: 'activation',
        skill: 'a',
        skillDirectory: '/d',
        instructionsPath: '/d/SKILL.md',
        imports,
      }),
    ).toBe(false);
  });

  it.each([
    ['a blank entry after a valid one', ['skill://a/notes.md', ' ']],
    ['a blank entry before a valid one', [' ', 'skill://a/notes.md']],
    ['a non-string entry beside a valid one', ['skill://a/notes.md', 1]],
  ])('rejects an omission import list with %s', (_label, imports) => {
    expect(
      isSkillActivationPayload({ kind: 'omission', skills: ['a'], imports }),
    ).toBe(false);
  });
});

describe('the payload guard on import remainder counts', () => {
  it.each([
    ['zero', 0],
    ['a negative count', -1],
    ['a fraction', 1.5],
    ['a numeric string', '2'],
  ])('refuses importsBeyond of %s', (_label, importsBeyond) => {
    expect(
      isSkillActivationPayload({
        kind: 'omission',
        skills: ['a'],
        importsBeyond,
      }),
    ).toBe(false);
  });

  it('refuses a negative skill remainder count', () => {
    expect(
      isSkillActivationPayload({ kind: 'omission', skills: ['a'], beyond: -1 }),
    ).toBe(false);
  });

  it('accepts a positive whole importsBeyond', () => {
    expect(
      isSkillActivationPayload({
        kind: 'omission',
        skills: ['a'],
        importsBeyond: 1,
      }),
    ).toBe(true);
  });
});

describe('a notice kept alive by carried-forward counts', () => {
  it('names the skill remainder when only unlisted skills remain', () => {
    const item = createSkillActivationOmissionItem({
      runId: RUN_ID,
      skills: [],
      unlisted: 3,
    });

    expect(item.data.payload).toEqual({
      kind: 'omission',
      skills: [],
      beyond: 3,
    });
    expect(bodyOf(item)).toContain('The user named more skills than one turn');
    expect(bodyOf(item)).toContain('and 3 more not listed here.');
    expect(bodyOf(item)).not.toContain('imported files');
  });

  it('names the import remainder when only unlisted imports remain', () => {
    const item = createSkillActivationOmissionItem({
      runId: RUN_ID,
      skills: [],
      unlistedImports: 3,
    });

    expect(item.data.payload).toEqual({
      kind: 'omission',
      skills: [],
      importsBeyond: 3,
    });
    expect(bodyOf(item)).toContain('These imported files were not loaded:');
    expect(bodyOf(item)).toContain('and 3 more not listed here.');
    expect(bodyOf(item)).not.toContain('The user named more');
  });
});
