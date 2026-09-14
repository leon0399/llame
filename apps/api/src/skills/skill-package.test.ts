import {
  SKILL_DESCRIPTION_MAX_LENGTH,
  parseSkillPackage,
  readFrontmatterInvocationControl,
  readSidecarInvocationControl,
} from './skill-package';

const document = (frontmatter: string, body = '# Body\n') =>
  `---\n${frontmatter}\n---\n${body}`;

describe('parseSkillPackage', () => {
  it('accepts a valid package and preserves unknown frontmatter fields', () => {
    const result = parseSkillPackage(
      document(
        'name: pdf\ndescription: Extract text.\nallowed-tools: Bash(git:*)\ncustom: 1',
      ),
      'pdf',
    );

    expect(result).toMatchObject({
      status: 'parsed',
      name: 'pdf',
      description: 'Extract text.',
    });
    // Unknown extension fields are inert and preserved, never interpreted.
    if (result.status !== 'parsed') throw new Error('expected parsed');
    expect(result.frontmatter['allowed-tools']).toBe('Bash(git:*)');
    expect(result.frontmatter['custom']).toBe(1);
  });

  it('accepts a description at exactly the published bound', () => {
    const description = 'x'.repeat(SKILL_DESCRIPTION_MAX_LENGTH);

    expect(
      parseSkillPackage(
        document(`name: pdf\ndescription: ${description}`),
        'pdf',
      ),
    ).toMatchObject({ status: 'parsed', description });
  });

  it('counts description characters as code points, not UTF-16 units', () => {
    // The bound is characters, so a supplementary-plane character counts once.
    // With `string.length` this 1024-character description would read as 2048
    // and be rejected; the ASCII-only fixtures elsewhere stay green either way,
    // which is exactly why this case is here.
    const emoji = '\u{1F600}';
    const description = emoji.repeat(SKILL_DESCRIPTION_MAX_LENGTH);

    expect(description.length).toBe(SKILL_DESCRIPTION_MAX_LENGTH * 2);

    expect(
      parseSkillPackage(
        document(`name: pdf\ndescription: ${description}`),
        'pdf',
      ),
    ).toMatchObject({ status: 'parsed', description });
  });

  it('rejects a code-point description one past the bound', () => {
    const emoji = '\u{1F600}';

    expect(
      parseSkillPackage(
        document(
          `name: pdf\ndescription: ${emoji.repeat(SKILL_DESCRIPTION_MAX_LENGTH + 1)}`,
        ),
        'pdf',
      ),
    ).toMatchObject({ status: 'invalid' });
  });

  it.each([
    ['no frontmatter block', '# Body\n', 'must start with a YAML frontmatter'],
    ['an unclosed block', '---\nname: pdf\n', 'not closed'],
    ['malformed YAML', document('name: [unclosed'), 'not valid YAML'],
    [
      'a non-mapping block',
      document('- just\n- a list'),
      'must be a YAML mapping',
    ],
    [
      'duplicate keys',
      document('name: pdf\nname: other\ndescription: d'),
      'not valid YAML',
    ],
    [
      'an invalid name',
      document('name: PDF\ndescription: d'),
      'lowercase letters',
    ],
    [
      'a name/directory mismatch',
      document('name: other\ndescription: d'),
      'does not match its directory',
    ],
    [
      'a missing description',
      document('name: pdf'),
      '`description` must be a non-empty string',
    ],
    [
      'a whitespace description',
      document('name: pdf\ndescription: "   "'),
      '`description` must be a non-empty string',
    ],
    [
      'an oversized description',
      document(
        `name: pdf\ndescription: ${'x'.repeat(SKILL_DESCRIPTION_MAX_LENGTH + 1)}`,
      ),
      'at most 1024 characters',
    ],
  ])('rejects %s', (_label, text, expected) => {
    const result = parseSkillPackage(text, 'pdf');

    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('expected invalid');
    expect(result.diagnostic).toContain(expected);
  });
});

describe('readSidecarInvocationControl', () => {
  it('reads a configured boolean', () => {
    expect(
      readSidecarInvocationControl(
        'policy:\n  allow_implicit_invocation: true\n',
      ),
    ).toBe(true);
    expect(
      readSidecarInvocationControl(
        'policy:\n  allow_implicit_invocation: false\n',
      ),
    ).toBe(false);
  });

  it.each([
    ['a sidecar with no policy', 'other: 1\n'],
    ['a policy with no control', 'policy: {}\n'],
  ])('falls through %s', (_label, text) => {
    expect(readSidecarInvocationControl(text)).toBe('absent');
  });

  it.each([
    ['malformed YAML', 'policy: [unclosed\n'],
    ['a non-mapping document', '- a list\n'],
    ['a scalar document', 'just text\n'],
    ['a wrong-typed control', 'policy:\n  allow_implicit_invocation: "yes"\n'],
    // A consulted sidecar whose `policy` is not a mapping is malformed, so the
    // package is invalid rather than falling through to a lower control.
    ['a non-mapping policy', 'policy: true\n'],
  ])('invalidates %s', (_label, text) => {
    expect(readSidecarInvocationControl(text)).toBe('invalid');
  });
});

describe('readFrontmatterInvocationControl', () => {
  it('inverts the disabling boolean', () => {
    expect(
      readFrontmatterInvocationControl({ 'disable-model-invocation': true }),
    ).toBe(false);
    expect(
      readFrontmatterInvocationControl({ 'disable-model-invocation': false }),
    ).toBe(true);
  });

  it('falls through when the field is absent', () => {
    expect(readFrontmatterInvocationControl({})).toBe('absent');
  });

  it('invalidates a wrong-typed value', () => {
    expect(
      readFrontmatterInvocationControl({ 'disable-model-invocation': 'yes' }),
    ).toBe('invalid');
  });
});
