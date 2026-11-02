import { citedArtifacts } from './fork-artifacts';

describe('citedArtifacts', () => {
  it('reads the locator a success part stores beside its result', () => {
    expect(
      citedArtifacts([
        {
          type: 'tool-grep',
          state: 'output-available',
          output: { content: '1: x' },
          artifact: 'artifact://grep-1',
        },
      ]),
    ).toEqual([{ toolName: 'grep', seq: 1 }]);
  });

  it('reads the locator an error part carries beside its error text', () => {
    expect(
      citedArtifacts([
        {
          type: 'tool-bash',
          state: 'output-error',
          errorText: 'exit 1',
          artifact: 'artifact://bash-2/stderr',
        },
      ]),
    ).toEqual([{ toolName: 'bash', seq: 2 }]);
  });

  it('collapses repeated locators of one artifact', () => {
    expect(
      citedArtifacts([
        {
          type: 'tool-bash',
          artifact: 'artifact://bash-2/stdout',
        },
        {
          type: 'tool-bash',
          artifact: 'artifact://bash-2/stderr',
        },
      ]),
    ).toEqual([{ toolName: 'bash', seq: 2 }]);
  });

  it('skips a part that is not a tool part', () => {
    expect(
      citedArtifacts([
        { type: 'text', text: 'artifact://grep-1' },
        { type: 'reasoning', artifact: 'artifact://grep-2' },
      ]),
    ).toEqual([]);
  });

  it('ignores a locator written in a tool input or prose', () => {
    expect(
      citedArtifacts([
        {
          type: 'tool-read',
          input: { path: 'artifact://grep-1' },
          output: { content: 'artifact://grep-2' },
        },
      ]),
    ).toEqual([]);
  });

  it('ignores a malformed locator and an over-range number', () => {
    expect(
      citedArtifacts([
        { type: 'tool-grep', artifact: 'artifact://grep' },
        { type: 'tool-grep', artifact: 'artifact://grep-2147483648' },
      ]),
    ).toEqual([]);
  });

  it('accepts the scheme in any case, as the read tool does', () => {
    expect(
      citedArtifacts([{ type: 'tool-grep', artifact: 'ARTIFACT://grep-3' }]),
    ).toEqual([{ toolName: 'grep', seq: 3 }]);
  });
});
