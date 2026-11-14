import {
  formatJobLocator,
  jobArtifactLocatorOf,
  parseJobLocatorText,
} from './job-locator';

describe('job locators', () => {
  it('formats a record and an output locator', () => {
    expect(formatJobLocator('bash', 7)).toBe('job://bash-7');
    expect(formatJobLocator('bash', 7, 'stdout')).toBe('job://bash-7/stdout');
  });

  it('names the artifact of a job that stored one, with the same number', () => {
    expect(
      jobArtifactLocatorOf({ executor: 'bash', seq: 7, artifactId: 'a1' }),
    ).toBe('artifact://bash-7');
    expect(
      jobArtifactLocatorOf({ executor: 'bash', seq: 7, artifactId: null }),
    ).toBeUndefined();
  });

  it('parses the record, the output, and an upper-case scheme', () => {
    expect(parseJobLocatorText('job://bash-4')).toEqual({
      executor: 'bash',
      seq: 4,
      output: undefined,
    });
    expect(parseJobLocatorText('JOB://bash-4/stderr')).toEqual({
      executor: 'bash',
      seq: 4,
      output: 'stderr',
    });
  });

  it('refuses another scheme and a malformed number', () => {
    expect(parseJobLocatorText('artifact://bash-4')).toBeUndefined();
    expect(parseJobLocatorText('job://bash-0')).toBeUndefined();
    expect(parseJobLocatorText('job://bash')).toBeUndefined();
  });
});
