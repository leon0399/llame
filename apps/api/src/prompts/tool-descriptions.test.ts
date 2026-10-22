import { existsSync, readFileSync } from 'node:fs';
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
    expect(isToolPromptId('never_registered')).toBe(false);
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

  it('discloses Machine locators and remote host authority on the host tools', () => {
    for (const id of ['read', 'edit', 'write', 'bash'] as const) {
      expect(loadPackagedToolDescription(id)).toContain('machine://');
    }
    // The disclosure is on every host tool: no sandbox, roots address only,
    // and no isolation between users who share a Machine.
    for (const id of ['read', 'edit', 'write', 'bash'] as const) {
      const description = loadPackagedToolDescription(id);
      expect(description).toMatch(/OS user/u);
      expect(description).toMatch(/roots? bound addressing only/u);
      expect(description).toMatch(/shared between users|shared Machine/u);
    }
  });

  it('discloses ssh locators and their remote host authority on read', () => {
    const description = loadPackagedToolDescription('read');
    expect(description).toContain('ssh://');
    // The form and its bounds: the 1 MiB file bound and the listing cap.
    expect(description).toMatch(/1 MiB/u);
    expect(description).toMatch(/1,000/u);
    // The authority: the remote login user, the instance's SSH identity, and
    // the absence of isolation between llame users on that host.
    expect(description).toMatch(/remote host as its login user/u);
    expect(description).toMatch(/SSH identity of the instance/u);
    expect(description).toMatch(/without isolation between llame users/u);
  });

  it('discloses ssh working directories and their remote host authority on bash', () => {
    const description = loadPackagedToolDescription('bash');
    // The form: a cwd locator that runs the command on that host.
    expect(description).toContain(
      '`ssh://[user@]host[:port]/<absolute path>` `cwd`',
    );
    expect(description).toMatch(/as the remote login user/u);
    // The env rule and the unreplayable end, as the ssh branch enforces them.
    expect(description).toContain('[A-Za-z_][A-Za-z0-9_]*');
    expect(description).toMatch(/outcome_unknown/u);
    // The authority: the instance's SSH identity and no isolation per user.
    expect(description).toMatch(/SSH identity of the instance/u);
    expect(description).toMatch(/no function isolates llame users/u);
  });

  it('tells the model to set the directory with cwd, not cd in command', () => {
    const description = loadPackagedToolDescription('bash');
    expect(description).toMatch(
      /Set the directory of a command with `cwd`, not with a `cd` in `command`/u,
    );
    // Inside a Workspace: no cwd or a relative one. Outside: an absolute one.
    expect(description).toMatch(
      /in an entered Workspace give no `cwd` or one relative to its root/u,
    );
    expect(description).toMatch(/with no Workspace give an absolute `cwd`/u);
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

// The packaged prompt says what the tool is for; the reference page says how
// it behaves. Both are read by the same model, so a tool id without a page is
// a documented capability nothing can reach, and a page whose heading names
// another tool documents the wrong one. The page lives at the repository
// root, outside this package, so Stryker's sandbox (which holds the mutated
// sources and symlinked node_modules only) cannot see it.
describe.skipIf(process.env.STRYKER_MUTATOR_WORKER !== undefined)(
  'reference documentation',
  () => {
    it('documents every packaged tool on its own reference page', () => {
      // Four levels up from this module's directory is the repository root.
      const repositoryRoot = path.resolve(__dirname, '..', '..', '..', '..');

      for (const id of TOOL_PROMPT_IDS) {
        const page = path.join(
          repositoryRoot,
          'docs/product/reference/tools',
          `${id.replaceAll('_', '-')}.md`,
        );
        expect(existsSync(page), `missing reference page for ${id}`).toBe(true);

        // The page's rendered title, so a page that drifted to another tool
        // cannot pass as this one's.
        expect(
          readFileSync(page, 'utf8').match(/^# .+$/mu)?.[0],
          `reference page for ${id} does not open with "# ${id}"`,
        ).toBe(`# ${id}`);
      }
    });
  },
);
