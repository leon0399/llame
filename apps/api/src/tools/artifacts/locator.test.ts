import {
  ARTIFACT_SCHEME,
  formatArtifactLocator,
  isLocatorName,
  parseArtifactLocator,
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
    expect(parseArtifactLocator('mcp__docs__fetch-4')).toEqual({
      toolName: 'mcp__docs__fetch',
      seq: 4,
      part: undefined,
    });
    expect(parseArtifactLocator('bash-2/stderr')).toEqual({
      toolName: 'bash',
      seq: 2,
      part: 'stderr',
    });
  });

  it('refuses a zero number and a malformed name', () => {
    expect(parseArtifactLocator('grep-0')).toBeUndefined();
    expect(parseArtifactLocator('-1')).toBeUndefined();
    expect(parseArtifactLocator('grep/1')).toBeUndefined();
    expect(parseArtifactLocator('grep-1/stdout/x')).toBeUndefined();
  });

  it('parses only a whole locator with the scheme', () => {
    expect(parseArtifactLocatorText('artifact://grep-7')).toEqual({
      toolName: 'grep',
      seq: 7,
      part: undefined,
    });
    expect(parseArtifactLocatorText('media://grep-7')).toBeUndefined();
  });

  it('accepts the token shape a tool and a stream name share', () => {
    expect(isLocatorName('web_search')).toBe(true);
    expect(isLocatorName('mcp__docs__fetch')).toBe(true);
    expect(isLocatorName('bad name')).toBe(false);
    expect(ARTIFACT_SCHEME).toBe('artifact');
  });
});
