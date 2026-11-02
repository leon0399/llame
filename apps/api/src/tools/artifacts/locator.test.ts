import {
  ARTIFACT_SCHEME,
  formatArtifactLocator,
  parseArtifactLocatorText,
} from './locator';

describe('artifact locator', () => {
  it('formats the tool, number, and optional part', () => {
    expect(formatArtifactLocator('grep', 1)).toBe('artifact://grep-1');
    expect(formatArtifactLocator('bash', 12, 'stdout')).toBe(
      'artifact://bash-12/stdout',
    );
  });

  it('parses a tool name that itself contains a hyphen', () => {
    expect(parseArtifactLocatorText('artifact://mcp__docs__fetch-4')).toEqual({
      toolName: 'mcp__docs__fetch',
      seq: 4,
      part: undefined,
    });
    expect(parseArtifactLocatorText('artifact://bash-2/stderr')).toEqual({
      toolName: 'bash',
      seq: 2,
      part: 'stderr',
    });
  });

  it('refuses a zero, a non-locator, and a malformed name', () => {
    expect(parseArtifactLocatorText('artifact://grep-0')).toBeUndefined();
    expect(parseArtifactLocatorText('artifact://-1')).toBeUndefined();
    expect(parseArtifactLocatorText('artifact://grep/1')).toBeUndefined();
    expect(
      parseArtifactLocatorText('artifact://grep-1/stdout/x'),
    ).toBeUndefined();
  });

  it('refuses a number above the Postgres integer', () => {
    expect(parseArtifactLocatorText('artifact://grep-2147483647')).toEqual({
      toolName: 'grep',
      seq: 2_147_483_647,
      part: undefined,
    });
    expect(
      parseArtifactLocatorText('artifact://grep-2147483648'),
    ).toBeUndefined();
    expect(
      parseArtifactLocatorText('artifact://grep-99999999999999999999'),
    ).toBeUndefined();
  });

  it('parses only a whole locator and accepts the scheme in any case', () => {
    expect(parseArtifactLocatorText('media://grep-7')).toBeUndefined();
    expect(parseArtifactLocatorText('ARTIFACT://grep-7')).toEqual({
      toolName: 'grep',
      seq: 7,
      part: undefined,
    });
    expect(ARTIFACT_SCHEME).toBe('artifact');
  });

  it('accepts the shared tool-id grammar, leading separators included', () => {
    expect(parseArtifactLocatorText('artifact://_hidden-1')).toEqual({
      toolName: '_hidden',
      seq: 1,
      part: undefined,
    });
    expect(parseArtifactLocatorText('artifact://-tool-2/-stream')).toEqual({
      toolName: '-tool',
      seq: 2,
      part: '-stream',
    });
    expect(parseArtifactLocatorText('artifact://tool name-1')).toBeUndefined();
    expect(
      parseArtifactLocatorText(`artifact://${'a'.repeat(65)}-1`),
    ).toBeUndefined();
  });
});
