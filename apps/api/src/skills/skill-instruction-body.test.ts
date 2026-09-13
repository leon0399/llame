/**
 * Tests for `skillInstructionBody`, the frontmatter-stripping helper the
 * activation item renders instruction bodies with.
 *
 * In its own file rather than beside the package parser's tests: this helper is
 * activation-layer code, and `skill-package.test.ts` belongs to a coverage
 * change on `master` that must not collide with this layer.
 */

import { skillInstructionBody } from './skill-package';

/** A `SKILL.md` document with the given frontmatter body. */
const document = (frontmatter: string, body: string) =>
  `---\n${frontmatter}\n---\n${body}`;

describe('skillInstructionBody', () => {
  it('removes the frontmatter block and its delimiters', () => {
    expect(
      skillInstructionBody(
        document('name: pdf\ndescription: d', '\n# PDF\n\nSteps.\n'),
      ),
    ).toBe('# PDF\n\nSteps.');
  });

  it('returns the whole text when it has no frontmatter', () => {
    expect(skillInstructionBody('# Just prose\n')).toBe('# Just prose\n');
  });

  it('returns the whole text when the block is never closed', () => {
    // Usability was already decided by `parseSkillPackage`; removing an
    // unterminated block here would invent a second answer.
    const unterminated = '---\nname: pdf\n# Body\n';
    expect(skillInstructionBody(unterminated)).toBe(unterminated);
  });

  it('keeps a delimiter that is not on its own line', () => {
    // Only a line consisting of `---` closes the block.
    expect(skillInstructionBody('---\nname: pdf\n--- \n# Body\n')).toBe(
      '# Body',
    );
  });

  it('yields an empty body when the file is only frontmatter', () => {
    expect(skillInstructionBody('---\nname: pdf\n---\n')).toBe('');
  });
});
