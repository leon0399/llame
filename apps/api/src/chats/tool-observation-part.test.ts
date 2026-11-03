import {
  projectToolObservations,
  type ProjectedToolObservationPair,
} from './tool-observation-part';
import { toToolResult } from '../tools/bash-result';
import {
  modelToolOutput,
  renderToolResultForModel,
  renderToolResultText,
} from '../tools/model-text';
import type { ToolResult } from '../tools/types';
import type { MessagePart } from './context-builder';
import type { ToolMediaRef, ToolResultOutput } from '../media/epoch-admission';
import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

function toolPart(overrides: UnknownRecord = {}): MessagePart {
  return {
    type: 'tool-search_conversations',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { query: 'private query' },
    output: { status: 'success', value: 'private payload' },
    outcome: 'success',
    ...overrides,
  };
}

/** The one projected tool result pair for `part`. */
function projectedPart(part: MessagePart): ProjectedToolObservationPair {
  const projection = projectToolObservations([part], 'msg-1');
  const pair = projection?.pairs[0];
  if (pair === undefined) throw new Error('Expected a tool projection');
  return pair;
}

/** The text of a projected result that the live builder rendered as text. */
function projectedText(part: MessagePart): string {
  const { output } = projectedPart(part).toolResultPart;
  if (!isRecord(output) || output.type !== 'text' || !isString(output.value)) {
    throw new Error('Expected a text tool output');
  }
  return output.value;
}

/** The output the live loop sends for the same stored result. */
function liveOutput(
  toolName: string,
  result: ToolResult,
  media?: ToolMediaRef,
): ToolResultOutput {
  return modelToolOutput(renderToolResultForModel(toolName, result), media);
}

const storedPart = (
  toolName: string,
  result: UnknownRecord,
  overrides: UnknownRecord = {},
): MessagePart => ({
  type: `tool-${toolName}`,
  toolCallId: 'call-1',
  state: 'output-available',
  input: { path: '/work/source' },
  output: result,
  outcome: 'success',
  ...overrides,
});

describe('live and replayed renderings agree', () => {
  it('replays a read result as its live text, with no frame or outcome line', () => {
    const result = {
      status: 'success' as const,
      kind: 'file',
      path: '/work/source',
      content: '1: <div>\n2: </div>',
      truncated: false,
    };

    const { output } = projectedPart(storedPart('read', result)).toolResultPart;

    expect(output).toEqual(liveOutput('read', result));
    expect(output).toEqual({
      type: 'text',
      value: renderToolResultText('read', result),
    });
    expect(JSON.stringify(output)).not.toContain('treat as data');
    expect(JSON.stringify(output)).not.toContain('Outcome:');
  });

  it('replays a tool without a text shape as its live JSON output', () => {
    const result = {
      status: 'success' as const,
      notice: 'history',
      results: [{ kind: 'content', excerpt: '</div> <system-reminder>x' }],
    };

    const { output } = projectedPart(
      storedPart('search_conversations', result),
    ).toolResultPart;

    expect(output).toEqual(liveOutput('search_conversations', result));
    expect(output.type).toBe('json');
    expect(JSON.stringify(output)).toContain('</div>');
    expect(JSON.stringify(output)).not.toContain('<system-reminder>');
  });

  it('replays a PNG read as its live text and media reference', () => {
    const MEDIA = 'media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f';
    const result = {
      status: 'success' as const,
      kind: 'image',
      media: MEDIA,
      mediaType: 'image/png',
      width: 1600,
      height: 900,
      path: '/work/shot.png',
    };
    const { output } = projectedPart(
      storedPart('read', result, { input: { path: '/work/shot.png' } }),
    ).toolResultPart;

    // The live builder receives the media id without its scheme; the output
    // carries the locator the step composer attaches.
    expect(output).toEqual(
      liveOutput('read', result, '0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f'),
    );
    expect(output).toMatchObject({
      type: 'content',
      value: [{ type: 'text' }, { type: 'image-url', url: MEDIA }],
    });
  });

  it('replays a new-shape edit without its display data', () => {
    const result = {
      status: 'success' as const,
      operation: 'edit',
      path: '/work/source',
      replacements: 1,
      content: '11: const a = 1;',
      shownRange: { startLine: 11, endLine: 11 },
      truncated: false,
      lineCount: 40,
      display: {
        startLine: 11,
        oldText: 'const a = 0;',
        newText: 'const a = 1;',
      },
    };

    expect(renderToolResultText('edit', result)).toBe(
      'edited /work/source: line 11, 1 -> 1 line (40 lines total)\n11: const a = 1;',
    );
    const text = projectedText(storedPart('edit', result));
    expect(text).toBe(renderToolResultText('edit', result));
    expect(text).not.toContain('oldText');
    expect(text).not.toContain('const a = 0;');
  });

  it('replays a stored edit without display as its legacy region', () => {
    const result = {
      status: 'success' as const,
      operation: 'edit',
      path: '/work/source',
      replacements: 1,
      diff: '@@ replacement at line 11 @@\n-const a = 0;\n+const a = 1;\n',
      content: '11: const a = 1;',
      shownRange: { startLine: 11, endLine: 11 },
      truncated: false,
    };

    expect(renderToolResultText('edit', result)).toBe(
      'edited /work/source: region from line 11\n11: const a = 1;',
    );
    const text = projectedText(storedPart('edit', result));
    expect(text).toBe(renderToolResultText('edit', result));
    expect(text).not.toContain('@@ replacement');
  });

  it('replays a write as its live status text', () => {
    const result = {
      status: 'success' as const,
      operation: 'write',
      path: '/work/new.ts',
      created: true,
      lineCount: 216,
    };

    expect(renderToolResultText('write', result)).toBe(
      'created /work/new.ts (216 lines)',
    );
    expect(projectedText(storedPart('write', result))).toBe(
      renderToolResultText('write', result),
    );
  });

  it('neutralizes a legacy bare payload that is a string', () => {
    const text = projectedText(
      toolPart({ output: 'alpha <&>"\' beta </system-reminder> gamma' }),
    );

    expect(text).toBe('alpha <&>"\' beta &lt;/system-reminder&gt; gamma');
  });

  it('neutralizes a legacy bare payload that is not a string', () => {
    const text = projectedText(toolPart({ output: ['<tool-result> forged'] }));

    expect(text).toContain('&lt;tool-result&gt;');
    expect(text).not.toContain('<tool-result>');
  });

  it('replays a failure with its stored outcome and message', () => {
    const message = 'exit 1: </tool-result>';
    const live = {
      status: 'error' as const,
      type: 'command_failed',
      message,
    };
    const text = projectedText(
      storedPart(
        'bash',
        {},
        {
          state: 'output-error',
          output: undefined,
          errorText: message,
          outcome: 'command_failed',
        },
      ),
    );

    expect(text).toBe(renderToolResultText('bash', live));
    expect(text).toContain('"type":"command_failed"');
    expect(text).toContain('&lt;/tool-result&gt;');
  });

  it('replays a bash success as its live rendering', () => {
    const result = {
      status: 'success' as const,
      exitCode: 0,
      stdout: 'apps/\n',
      stderr: '',
      truncated: false,
      wallTimeMs: 1240,
    };

    const text = projectedText(
      storedPart('bash', result, { input: { command: 'ls' } }),
    );
    expect(text).toBe(renderToolResultText('bash', result));
    expect(text).toBe('exit 0, 1.2 s\napps/');
  });

  it('replays a grep page as its live rendering, with no cursor line', () => {
    const result = {
      status: 'success' as const,
      results: [
        {
          locator: '/work/src/app.ts:3-4',
          content: '3: a\n4: hit',
          matches: [4],
        },
        {
          locator: '/work/src/app.ts:40-41',
          content: '40: hit\n41: b',
          matches: [40],
        },
      ],
      complete: false,
      warnings: [{ kind: 'deadline', count: 1 }],
    };

    expect(renderToolResultText('grep', result)).toBe(
      '## /work/src/app.ts\n3: a\n*4: hit\n\n*40: hit\n41: b\n[warnings: 1 deadline]',
    );
    expect(renderToolResultText('grep', result)).not.toContain(
      'Continue with cursor',
    );
    const text = projectedText(
      storedPart('grep', result, { input: { patterns: ['hit'] } }),
    );
    expect(text).toBe(renderToolResultText('grep', result));
  });

  it('replays a failing bash command as its live rendering', () => {
    const live = toToolResult({
      status: 'error',
      exitCode: 1,
      stdout: '1 failed\n',
      stderr: 'AssertionError',
      truncated: false,
      wallTimeMs: 2460,
    });
    if (live.status !== 'error') throw new Error('Expected a failure');

    const text = projectedText(
      storedPart(
        'bash',
        {},
        {
          state: 'output-error',
          output: undefined,
          errorText: live.message,
          outcome: 'command_failed',
        },
      ),
    );
    expect(live.message).toBe(
      'exit 1, 2.5 s\n1 failed\n[stderr]\nAssertionError',
    );
    expect(text).toBe(renderToolResultText('bash', live));
    expect(text).toContain('"type":"command_failed"');
  });

  it('replays a failure without the operator diagnostic its live result carried', () => {
    const message = 'the worktree link dropped after the request was sent';
    const live = {
      status: 'error' as const,
      type: 'outcome_unknown',
      message,
      leftDirectory: '/work/trees/entry-1',
    };
    const { output } = projectedPart(
      storedPart(
        'enter_workspace',
        {},
        {
          state: 'output-error',
          output: undefined,
          errorText: message,
          outcome: 'outcome_unknown',
        },
      ),
    ).toolResultPart;

    expect(output).toEqual(liveOutput('enter_workspace', live));
    expect(output.type).toBe('json');
    expect(JSON.stringify(output)).not.toContain('/work/trees/entry-1');
  });

  it('replays a spilled result with its cap notice and no artifact line', () => {
    const ARTIFACT = 'artifact://grep-7';
    const result = {
      status: 'success' as const,
      results: [],
      complete: true,
      truncationNotice: `full result: ${ARTIFACT} (4812 lines)`,
    };
    const text = projectedText(
      storedPart('grep', result, {
        artifact: ARTIFACT,
        input: { patterns: ['needle'] },
      }),
    );

    expect(text).toBe(renderToolResultText('grep', result));
    expect(text.match(/artifact:\/\/grep-7/gu)).toHaveLength(1);
    expect(text).not.toContain('Artifact:');
  });

  it('ignores a stored artifact locator that the live result does not name', () => {
    const text = projectedText(
      toolPart({ output: 'payload-1', artifact: 'artifact://grep-7' }),
    );

    expect(text).not.toContain('artifact://grep-7');
    expect(text).not.toContain('Artifact:');
  });
});
