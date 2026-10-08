import { expandSkillImports, type SkillImport } from './skill-imports';
import {
  SKILL_MAX_PATH_BYTES,
  SKILL_MAX_PATH_COMPONENTS,
} from './skill-locator';
import {
  auditedContext,
  fileResult,
  notFoundResult,
  scriptedReadTool,
  STUB_RUN_ID,
} from './skill-read.stub';
import { type Tool, type ToolResult } from '../tools/types';

const DEADLINE = 10_000;

/** A clock the scripted read can advance, so a read can finish "late". */
function freezeClock(now: number) {
  const clock = { now };
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
  return clock;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function expand(
  body: string,
  readTool: Tool,
  options: {
    readonly deadline?: number;
    readonly abortSignal?: AbortSignal;
    readonly canAccept?: (imports: ReadonlyArray<SkillImport>) => boolean;
  } = {},
) {
  const h = auditedContext();
  return expandSkillImports({
    skill: 'research',
    runId: STUB_RUN_ID,
    mentionOrdinal: 0,
    body,
    selection: new Set(['research']),
    toolContext:
      options.abortSignal === undefined
        ? h.context
        : { ...h.context, abortSignal: options.abortSignal },
    readTool,
    callTimeoutSeconds: 5,
    deadline: options.deadline ?? Date.now() + 60_000,
    activity: h.activity,
    canAccept: options.canAccept ?? (() => true),
  }).then((expansion) => ({ ...h, expansion }));
}

describe('package import reads', () => {
  describe('the work deadline', () => {
    it('names an import without reading it once no time remains', async () => {
      freezeClock(DEADLINE);

      const { expansion, audit } = await expand(
        '@a.md',
        scriptedReadTool(() => fileResult('A')),
        { deadline: DEADLINE },
      );

      expect(expansion.omitted).toEqual(['skill://research/a.md']);
      expect(audit).toEqual([]);
    });

    it.each(['cancelled', 'timeout', 'timed_out'])(
      'names the import and stops when a read ends %s at the deadline',
      async (type) => {
        const clock = freezeClock(1000);

        const { expansion, requestedPaths } = await expand(
          '@a.md @b.md',
          scriptedReadTool(() => {
            clock.now = DEADLINE;
            return { status: 'error', type, message: 'ended' };
          }),
          { deadline: DEADLINE },
        );

        expect(expansion.imports).toEqual([]);
        expect(expansion.omitted).toEqual([
          'skill://research/a.md',
          'skill://research/b.md',
        ]);
        expect(requestedPaths()).toEqual(['skill://research/a.md:raw']);
      },
    );

    it('keeps going when a read times out with time still on the clock', async () => {
      freezeClock(1000);
      const slow: ToolResult = {
        status: 'error',
        type: 'timeout',
        message: 'slow',
      };

      const { expansion } = await expand(
        '@a.md @b.md',
        scriptedReadTool((path) =>
          path === 'skill://research/a.md:raw' ? slow : fileResult('B'),
        ),
        { deadline: DEADLINE },
      );

      expect(expansion.omitted).toEqual([]);
      expect(expansion.imports.map((file) => file.path)).toEqual([
        'skill://research/b.md',
      ]);
    });

    it('does not name an import whose read failed for another reason late', async () => {
      const clock = freezeClock(1000);

      const { expansion } = await expand(
        '@a.md',
        scriptedReadTool(() => {
          clock.now = DEADLINE + 1;
          return notFoundResult();
        }),
        { deadline: DEADLINE },
      );

      expect(expansion.omitted).toEqual([]);
      expect(expansion.imports).toEqual([]);
    });

    it('keeps a file that loaded even though the deadline passed meanwhile', async () => {
      const clock = freezeClock(1000);

      const { expansion } = await expand(
        '@a.md',
        scriptedReadTool(() => {
          clock.now = DEADLINE + 1;
          return fileResult('A', { type: 'timeout' });
        }),
        { deadline: DEADLINE },
      );

      expect(expansion.omitted).toEqual([]);
      expect(expansion.imports.map((file) => file.body)).toEqual(['A']);
    });

    it('aborts a read when the Run aborts', async () => {
      const controller = new AbortController();
      const wasAbortedByRun: Array<boolean> = [];

      await expand(
        '@a.md',
        scriptedReadTool((_path, context) => {
          controller.abort();
          wasAbortedByRun.push(context.abortSignal?.aborted === true);
          return notFoundResult();
        }),
        { abortSignal: controller.signal },
      );

      expect(wasAbortedByRun).toEqual([true]);
    });

    it('aborts a read that outlives the work budget', async () => {
      const budget: Array<AbortSignal | undefined> = [];
      await expand(
        '@a.md',
        scriptedReadTool((_path, context) => {
          budget.push(context.abortSignal);
          return new Promise<ToolResult>(() => undefined);
        }),
        {
          deadline: Date.now() + 30,
          abortSignal: new AbortController().signal,
        },
      );

      expect(budget[0]?.aborted).toBe(true);
    });
  });

  describe('what a read result may contribute', () => {
    it('carries the reader truncation notice with the file', async () => {
      const { expansion } = await expand(
        '@a.md',
        scriptedReadTool(() =>
          fileResult('partial', { truncationNotice: 'Cut short.' }),
        ),
      );

      expect(expansion.imports).toEqual([
        {
          path: 'skill://research/a.md',
          body: 'partial',
          truncationNotice: 'Cut short.',
        },
      ]);
    });

    const fileFields = { kind: 'file', content: 'leaked' };
    const leaked: ToolResult = {
      ...fileFields,
      status: 'error',
      type: 'not_found',
      message: 'missing',
    };

    const listing: ToolResult = {
      status: 'success',
      kind: 'directory',
      content: 'listing',
    };
    const noText: ToolResult = { status: 'success', kind: 'file' };

    it.each([
      ['an error result that carries file-shaped fields', leaked],
      ['a directory result', listing],
      ['a file result without text', noText],
    ])('skips %s', async (_label, result) => {
      const { expansion } = await expand(
        '@a.md',
        scriptedReadTool(() => result),
      );

      expect(expansion.imports).toEqual([]);
      expect(expansion.omitted).toEqual([]);
    });
  });

  describe('which targets are read', () => {
    it('never imports the package document it came from', async () => {
      const { expansion, requestedPaths } = await expand(
        '@SKILL.md @a.md',
        scriptedReadTool((path) =>
          path === 'skill://research/a.md:raw'
            ? fileResult('See @SKILL.md and @../SKILL.md')
            : notFoundResult(),
        ),
      );

      expect(expansion.imports.map((file) => file.path)).toEqual([
        'skill://research/a.md',
      ]);
      expect(requestedPaths()).toEqual(['skill://research/a.md:raw']);
    });

    it('leaves a target that resolves to the package root unread', async () => {
      const { requestedPaths } = await expand(
        '[here](sub/.. "import") [above](sub/../.. "import")',
        scriptedReadTool(() => notFoundResult()),
      );

      expect(requestedPaths()).toEqual([]);
    });

    it('reads a path of exactly the allowed component count and byte length', async () => {
      const deep = `${Array.from(
        { length: SKILL_MAX_PATH_COMPONENTS - 1 },
        () => 'n',
      ).join('/')}/leaf.md`;
      const long = `${'a'.repeat(SKILL_MAX_PATH_BYTES - '.md'.length)}.md`;

      const { requestedPaths } = await expand(
        `@${deep} @${long}`,
        scriptedReadTool(() => notFoundResult()),
      );

      expect(requestedPaths()).toEqual([
        `skill://research/${deep}:raw`,
        `skill://research/${long}:raw`,
      ]);
    });

    it('measures the path limit in bytes, not characters', async () => {
      // 511 two-byte characters plus ".md" is 1025 bytes in 514 characters.
      const wide = `${'é'.repeat(511)}.md`;

      const { requestedPaths } = await expand(
        `@${wide}`,
        scriptedReadTool(() => notFoundResult()),
      );

      expect(requestedPaths()).toEqual([]);
    });
  });

  describe('the admission pre-check', () => {
    const sizeOf = (imports: ReadonlyArray<SkillImport>) =>
      imports.reduce(
        (sum, file) => sum + file.path.length + file.body.length,
        0,
      );
    const first = 'skill://research/a.md';
    const second = 'skill://research/b.md';

    it.each([
      ['fits by name alone', first.length + 1 + second.length, true],
      [
        'does not fit even by name',
        first.length + 1 + second.length - 1,
        false,
      ],
    ])(
      'reads the next file only when its locator %s',
      async (_label, limit, reads) => {
        const { expansion, requestedPaths } = await expand(
          '@a.md @b.md',
          scriptedReadTool(() => fileResult('X')),
          { canAccept: (imports) => sizeOf(imports) <= limit },
        );

        expect(expansion.imports.map((file) => file.path)).toEqual([first]);
        expect(expansion.omitted).toEqual([second]);
        expect(requestedPaths()).toEqual([
          `${first}:raw`,
          ...(reads ? [`${second}:raw`] : []),
        ]);
      },
    );
  });
});
