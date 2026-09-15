import path from 'node:path';
import type * as NodeFs from 'node:fs';

import {
  isToolPromptId,
  loadPackagedToolDescription,
  resolvePackagedToolDescriptionPath,
  TOOL_PROMPT_IDS,
} from './tool-descriptions';

// The loader's guards describe what happens when a packaged asset did not ship
// or shipped blank. Both are filesystem states, so the module's `node:fs` view
// is mocked with a passthrough default and overridden per test — the loader
// still reads the real files everywhere else.
const fsMocks = vi.hoisted(() => ({
  statSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  fsMocks.statSync.mockImplementation(actual.statSync);
  fsMocks.readFileSync.mockImplementation(actual.readFileSync);
  return {
    ...actual,
    statSync: fsMocks.statSync,
    readFileSync: fsMocks.readFileSync,
  };
});

describe('isToolPromptId', () => {
  it('accepts exactly the registered packaged tool ids', () => {
    for (const id of TOOL_PROMPT_IDS) {
      expect(isToolPromptId(id)).toBe(true);
    }
  });

  it('rejects an id the packaged registry does not carry', () => {
    expect(isToolPromptId('grep')).toBe(false);
    expect(isToolPromptId('')).toBe(false);
    expect(isToolPromptId('mcp__demo__lookup')).toBe(false);
  });
});

describe('resolvePackagedToolDescriptionPath', () => {
  it('resolves under the built prompts/tools directory next to this module', () => {
    expect(resolvePackagedToolDescriptionPath('bash')).toBe(
      path.resolve(__dirname, 'tools', 'bash.md'),
    );
  });
});

describe('loadPackagedToolDescription', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and normalizes every packaged description', () => {
    for (const id of TOOL_PROMPT_IDS) {
      const description = loadPackagedToolDescription(id);
      expect(description.trim().length).toBeGreaterThan(0);
      // Normalized: no CRLF/CR left, and no trailing whitespace.
      expect(description).not.toMatch(/\r/u);
      expect(description).toBe(description.replace(/\s+$/u, ''));
    }
  });

  it('normalizes CRLF and trailing whitespace out of a Windows-authored asset', () => {
    fsMocks.readFileSync.mockReturnValueOnce('line one\r\nline two   \r\n\r\n');

    expect(loadPackagedToolDescription('bash')).toBe('line one\nline two');
  });

  it('fails loudly, naming the id and the expected path, when the packaged file is missing', () => {
    fsMocks.statSync.mockReturnValueOnce(undefined);
    const expectedPath = resolvePackagedToolDescriptionPath('bash');

    expect(() => loadPackagedToolDescription('bash')).toThrow(
      `Packaged tool description missing: bash (expected ${expectedPath})`,
    );
  });

  it('fails loudly, naming the id, when a packaged file exists but is blank', () => {
    fsMocks.readFileSync.mockReturnValueOnce('   \n\t\n');

    expect(() => loadPackagedToolDescription('bash')).toThrow(
      'Packaged tool description empty: bash',
    );
  });
});
