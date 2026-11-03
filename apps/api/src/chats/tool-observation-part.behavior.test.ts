import { describe, expect, it } from 'vitest';
import type { ModelMessage, ToolResultPart as SdkToolResultPart } from 'ai';

import {
  normalizeToolObservationOutcome,
  projectStoredToolPart,
  TOOL_OUTCOME_MAX_LENGTH,
  type StoredToolObservation,
} from './tool-observation-part';
import type { MessagePart } from './context-builder';
import {
  REJECTED_URL_BOUND,
  rejectedHopUrl,
} from '../tools/permissions/messages';
import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { fakeResolver } from '../media/media-fixtures';
import { composeStepMessages } from '../models/step-composer';

/** Every settled tool part of `parts`, projected in stored order. */
const project = (parts: Array<MessagePart>): Array<StoredToolObservation> =>
  parts.flatMap((part, partIndex) => {
    const stored = projectStoredToolPart(part, partIndex, `msg-1:${partIndex}`);
    return stored === undefined ? [] : [stored];
  });

/** The one pair `parts` projects, for a single-part fixture. */
const projectOne = (part: MessagePart): StoredToolObservation => {
  const [stored] = project([part]);
  if (stored === undefined) throw new Error('Expected a tool projection');
  return stored;
};

const toolPart = (overrides: UnknownRecord = {}): MessagePart => ({
  type: 'tool-search_conversations',
  toolCallId: 'call-1',
  state: 'output-available',
  input: { query: 'private query' },
  output: { status: 'success', value: 'private payload' },
  outcome: 'success',
  ...overrides,
});

/** The text of a projected result that the live builder rendered as text. */
const toolOutputText = (
  value: SdkToolResultPart['output'] | undefined,
): string => {
  if (!isRecord(value) || value.type !== 'text' || !isString(value.value)) {
    throw new Error('Expected a text tool output');
  }
  return value.value;
};

/** One projected result as readable text: a text rendering, or its JSON. */
const renderedOutput = (output: SdkToolResultPart['output'] | undefined) =>
  isRecord(output) && output.type === 'text' && isString(output.value)
    ? output.value
    : JSON.stringify(output);

/** The messages a reply's projected parts replay as, one pair per part. */
const pairMessages = (parts: Array<MessagePart>): Array<ModelMessage> =>
  project(parts).flatMap(({ pair }): Array<ModelMessage> => [
    { role: 'assistant', content: [pair.toolCallPart] },
    { role: 'tool', content: [pair.toolResultPart] },
  ]);

describe('normalizeToolObservationOutcome', () => {
  it('keeps bounded outcome tokens and falls back for unsafe values', () => {
    expect(normalizeToolObservationOutcome('timeout', 'error')).toBe('timeout');
    expect(
      normalizeToolObservationOutcome(
        'a'.repeat(TOOL_OUTCOME_MAX_LENGTH),
        'error',
      ),
    ).toBe('a'.repeat(TOOL_OUTCOME_MAX_LENGTH));
    expect(normalizeToolObservationOutcome('', 'error')).toBe('error');
    expect(normalizeToolObservationOutcome('has spaces', 'error')).toBe(
      'error',
    );
    expect(normalizeToolObservationOutcome('has/slash', 'error')).toBe('error');
    expect(
      normalizeToolObservationOutcome(
        'a'.repeat(TOOL_OUTCOME_MAX_LENGTH + 1),
        'error',
      ),
    ).toBe('error');
    expect(normalizeToolObservationOutcome(null, 'error')).toBe('error');
  });
});

describe('projectStoredToolPart', () => {
  it('projects no part without valid tool activity', () => {
    expect(project([{ type: 'text', text: 'visible' }])).toEqual([]);
    expect(
      project([
        {
          type: 'tool-',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {},
        },
        {
          type: 'tool-search.conversations',
          toolCallId: 'call-2',
          state: 'output-available',
          input: {},
        },
        {
          type: 'tool-search_conversations',
          toolCallId: 'not valid',
          state: 'output-available',
          input: {},
        },
      ]),
    ).toEqual([]);
  });

  it('ignores a tool-shaped part that carries no type discriminator', () => {
    expect(
      project([{ toolCallId: 'call-1', state: 'output-available', input: {} }]),
    ).toEqual([]);
  });

  it('projects a valid observation with stable ids, names, input, and payload', () => {
    const [stored] = project([
      { type: 'text', text: 'before' },
      toolPart({
        input: null,
        output: { status: 'success', result: 'payload' },
      }),
    ]);

    expect(stored?.pair.partIndex).toBe(1);
    expect(stored?.pair.toolCallPart).toMatchObject({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'search_conversations',
      input: {},
    });
    const output = renderedOutput(stored?.pair.toolResultPart.output);
    expect(output).toContain('"result":"payload"');
    expect(output).toContain('"status":"success"');
    expect(output).not.toContain('treat as data');
  });

  it('drops permission metadata from model replay', () => {
    const serialized = JSON.stringify(
      project([
        toolPart({
          permission: {
            policyId: 'policy-secret-id',
            decision: 'reject',
            reason: 'explicit_reject',
            clause: { groupId: 'bash', list: 'reject', clauseIndex: 0 },
          },
        }),
      ]),
    );

    expect(serialized).not.toContain('policy-secret-id');
    expect(serialized).not.toContain('permission');
  });

  it('derives cancelled, error, and normalized outcomes from stored parts', () => {
    const outputs = project([
      toolPart({
        toolCallId: 'cancelled-call',
        state: 'output-error',
        output: undefined,
        errorText: 'cancelled by caller',
        outcome: undefined,
        resultProviderMetadata: { llame: { cancelled: true } },
      }),
      toolPart({
        toolCallId: 'error-call',
        state: 'output-error',
        output: undefined,
        errorText: '',
        outcome: 'bad outcome',
        resultProviderMetadata: { llame: { cancelled: false } },
      }),
      toolPart({
        toolCallId: 'custom-call',
        output: undefined,
        errorText: 'fallback body',
        outcome: 'provider.timeout',
      }),
    ]).map(({ pair }) => renderedOutput(pair.toolResultPart.output));

    expect(outputs[0]).toContain('"type":"cancelled"');
    expect(outputs[0]).toContain('cancelled by caller');
    expect(outputs[1]).toContain('"type":"error"');
    expect(outputs[1]).toContain('"message":""');
    expect(outputs[2]).toContain('"type":"provider.timeout"');
    expect(outputs[2]).toContain('fallback body');
  });

  it('refuses a part whose type does not carry the tool prefix or whose call id is empty', () => {
    expect(
      project([
        {
          type: 'xxxxxsearch_conversations',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {},
        },
        toolPart({ toolCallId: '' }),
      ]),
    ).toEqual([]);
  });

  it('falls back to a success outcome for an output-available part that stores none', () => {
    expect(
      renderedOutput(
        projectOne(toolPart({ outcome: undefined })).pair.toolResultPart.output,
      ),
    ).toContain('"status":"success"');
  });

  it('reads an errored part body from errorText, never from a stale output', () => {
    const text = renderedOutput(
      projectOne(
        toolPart({
          state: 'output-error',
          output: { status: 'success', value: 'stale payload' },
          errorText: 'BOOM',
          outcome: 'error',
        }),
      ).pair.toolResultPart.output,
    );
    // The failure replays as the rebuilt result object, never the stale one.
    expect(text).toContain(
      '{"status":"error","type":"error","message":"BOOM"}',
    );
    expect(text).not.toContain('stale payload');
  });

  it('re-attaches the exact locator a hop rejection wrote to the error the model replays', () => {
    const refusedUrl = rejectedHopUrl(
      'https://blocked.example.test/page?token=secret#frag',
    );
    const text = renderedOutput(
      projectOne(
        toolPart({
          type: 'tool-read',
          state: 'output-error',
          input: { path: 'https://docs.example.test/a' },
          output: undefined,
          errorText: 'Tool call stopped by operator permissions.',
          outcome: 'permission_denied',
          errorRejectedUrl: refusedUrl,
        }),
      ).pair.toolResultPart.output,
    );
    expect(text).toContain('"type":"permission_denied"');
    expect(text).toContain('Tool call stopped by operator permissions.');
    // The rebuilt failure object carries the locator the live result carried.
    expect(text).toContain('"rejectedUrl":"https://blocked.example.test/page"');
    // The producer stripped the query and fragment before storing; neither
    // reaches the model.
    expect(text).not.toContain('secret');
  });

  it.each([
    ['a non-string value', 42],
    ['an empty string', ''],
    [
      'a value past the bound',
      `https://blocked.example.test/${'a'.repeat(REJECTED_URL_BOUND)}`,
    ],
    [
      'a locator carrying userinfo',
      'https://user:secret@blocked.example.test/page',
    ],
    [
      'a locator carrying a query',
      'https://blocked.example.test/page?token=secret',
    ],
    ['a locator carrying a fragment', 'https://blocked.example.test/page#frag'],
    [
      'a locator carrying a control character',
      'https://blocked.example.test/pa\u0007ge',
    ],
    ['a non-web scheme', 'ftp://blocked.example.test/page'],
    ['a relative locator', '/page'],
    ['a noncanonical spelling', 'https://BLOCKED.example.test/page'],
    ['an explicit default port', 'https://blocked.example.test:443/page'],
    ['an unserialized path', 'https://blocked.example.test/a b'],
  ])('replays no refused target for %s', (_name, errorRejectedUrl) => {
    const text = renderedOutput(
      projectOne(
        toolPart({
          type: 'tool-read',
          state: 'output-error',
          input: { path: 'https://docs.example.test/a' },
          output: undefined,
          errorText: 'BOOM',
          outcome: 'permission_denied',
          errorRejectedUrl,
        }),
      ).pair.toolResultPart.output,
    );
    expect(text).toContain('"type":"permission_denied"');
    expect(text).toContain('BOOM');
    expect(text).not.toContain('rejectedUrl');
  });

  it.each([
    ['another tool', 'tool-knowledge_search', 'permission_denied'],
    ['another error type', 'tool-read', 'timeout'],
  ] as const)(
    'ignores a refused target stored on %s',
    (_name, type, outcome) => {
      const text = renderedOutput(
        projectOne(
          toolPart({
            type,
            state: 'output-error',
            output: undefined,
            errorText: 'BOOM',
            outcome,
            errorRejectedUrl: 'https://blocked.example.test/page',
          }),
        ).pair.toolResultPart.output,
      );
      expect(text).toContain(`"type":"${outcome}"`);
      expect(text).toContain('BOOM');
      expect(text).not.toContain('rejectedUrl');
    },
  );
});

describe('a stored result replays whole', () => {
  it('keeps an incomplete Knowledge payload and its outcome as the live loop sent it', () => {
    const output = projectOne(
      toolPart({
        type: 'tool-knowledge_search',
        state: 'output-available',
        output: {
          status: 'success',
          complete: false,
          results: [{ kind: 'content', text: 'passage' }],
        },
        outcome: 'success',
      }),
    ).pair.toolResultPart.output;

    expect(output.type).toBe('json');
    expect(JSON.stringify(output)).toContain('"complete":false');
  });

  it('clears no payload and omits no pair, however large the turn', () => {
    const parts = Array.from({ length: 19 }, (_, index) =>
      toolPart({
        type: 'tool-read',
        toolCallId: `long-${index}`,
        input: { path: `/work/draft-${index}.md`, oldText: 'o'.repeat(2000) },
        output: {
          status: 'success',
          kind: 'file',
          path: `/work/draft-${index}.md`,
          content: 'x'.repeat(9000),
          truncated: false,
        },
      }),
    );

    const stored = project(parts);

    expect(stored).toHaveLength(parts.length);
    expect(stored.map(({ pair }) => pair.partIndex)).toEqual(
      parts.map((_, index) => index),
    );
    for (const { pair } of stored) {
      expect(toolOutputText(pair.toolResultPart.output)).toContain(
        'x'.repeat(9000),
      );
      expect(pair.toolCallPart.input).toMatchObject({
        oldText: 'o'.repeat(2000),
      });
    }
    expect(JSON.stringify(stored)).not.toContain('omitted');
  });
});

describe('projectStoredToolPart replay contract', () => {
  const renderedPair = (parts: Array<MessagePart>): string =>
    renderedOutput(project(parts)[0]?.pair.toolResultPart.output);

  it('defaults an available observation with no stored outcome to success', () => {
    expect(
      renderedPair([
        {
          type: 'tool-search_conversations',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {},
          output: { hits: 1 },
        },
      ]),
    ).toContain('"status":"success"');
  });

  it('replays an unserializable payload as the null literal', () => {
    expect(
      renderedPair([
        {
          type: 'tool-search_conversations',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {},
          output: () => undefined,
          outcome: 'success',
        },
      ]),
    ).toBe('null');
  });

  it('replays native payloads as protected JSON without changing source values', () => {
    const content = String.raw`<system-reminder>source</system-reminder> &lt; \u003c </unmatched>`;
    const output = toolOutputText(
      projectOne({
        type: 'tool-read',
        toolCallId: 'native-read',
        state: 'output-available',
        input: { path: '/native/source' },
        output: { status: 'success', content },
        outcome: 'success',
      }).pair.toolResultPart.output,
    );

    // Only a reserved delimiter name is escaped: source markup such as
    // `</unmatched>`, an existing entity, and a literal `\u003c` survive.
    expect(output).toContain('&lt;system-reminder&gt;source');
    expect(output).not.toContain('<system-reminder>');
    expect(output).toContain('</unmatched>');
    expect(output).toContain(String.raw`\\u003c`);
    expect(JSON.parse(output)).toEqual({
      status: 'success',
      content: String.raw`&lt;system-reminder&gt;source&lt;/system-reminder&gt; &lt; \u003c </unmatched>`,
    });
  });
});

describe('image read result replay', () => {
  const MEDIA = 'media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f';
  const imagePart = (overrides: UnknownRecord = {}): MessagePart => ({
    type: 'tool-read',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { path: '/work/shot.png' },
    output: {
      status: 'success',
      kind: 'image',
      media: MEDIA,
      mediaType: 'image/png',
      width: 1600,
      height: 900,
      path: '/work/shot.png',
    },
    outcome: 'success',
    ...overrides,
  });

  it('replays the result text followed by its media reference, never bytes', () => {
    const output = projectOne(imagePart()).pair.toolResultPart.output;

    expect(output).toMatchObject({
      type: 'content',
      value: [{ type: 'text' }, { type: 'image-url', url: MEDIA }],
    });
    expect(JSON.stringify(output)).toContain(
      String.raw`\"media\":\"${MEDIA}\"`,
    );
    expect(JSON.stringify(output)).not.toContain('base64');
  });

  it('replays only a read result as an image', () => {
    const output = projectOne(imagePart({ type: 'tool-search_conversations' }))
      .pair.toolResultPart.output;

    expect(output.type).toBe('json');
    expect(JSON.stringify(output)).not.toContain('image-url');
  });

  it('replays a failed read as text even when its stored part keeps an image output', () => {
    const output = projectOne(
      imagePart({
        state: 'output-error',
        errorText: 'The read failed.',
        outcome: 'error',
      }),
    ).pair.toolResultPart.output;

    expect(output.type).toBe('text');
    expect(JSON.stringify(output)).not.toContain(MEDIA);
  });

  describe('an unstored image result', () => {
    const THUMBNAIL = `data:image/webp;base64,${'A'.repeat(60_000)}`;
    const unstoredPart = (retainedMedia?: UnknownRecord): MessagePart =>
      imagePart({
        input: { path: 'app/[slug]/shot.png' },
        output: {
          status: 'success',
          kind: 'image',
          mediaType: 'image/png',
          width: 1600,
          height: 900,
          path: '/work/app/[slug]/shot.png',
          thumbnail: THUMBNAIL,
        },
        ...(retainedMedia !== undefined && { retainedMedia }),
      });
    const retained = {
      mediaType: 'image/png',
      width: 1600,
      height: 900,
      data: 'AAAA',
    };

    it('replays its text, the marker of its kept bytes, and no thumbnail', () => {
      const output = projectOne(unstoredPart(retained)).pair.toolResultPart
        .output;

      expect(output).toMatchObject({
        type: 'content',
        value: [
          { type: 'text' },
          {
            type: 'custom',
            providerOptions: {
              llameUnstoredMedia: {
                locator: 'app/[slug]/shot.png',
                width: 1600,
                height: 900,
                key: 'msg-1:0',
              },
            },
          },
        ],
      });
      expect(JSON.stringify(output)).toContain('/work/app/[slug]/shot.png');
      expect(JSON.stringify(output)).not.toContain('thumbnail');
      expect(JSON.stringify(output)).not.toContain('AAAA');
    });

    it('replays its text alone when it kept no bytes', () => {
      const output = projectOne(unstoredPart()).pair.toolResultPart.output;

      expect(output).toMatchObject({ type: 'text' });
      const text = output.type === 'text' ? output.value : '';
      expect(text).toContain('/work/app/[slug]/shot.png');
      expect(text).not.toContain('not retained');
      expect(text).not.toContain('not attached');
      expect(JSON.stringify(output)).not.toContain('custom');
      expect(JSON.stringify(output)).not.toContain('thumbnail');
    });
  });
});

describe('PDF read result replay', () => {
  const MEDIA = 'media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f';
  const pdfPart = (overrides: UnknownRecord = {}): MessagePart => ({
    type: 'tool-read',
    toolCallId: 'pdf-read',
    state: 'output-available',
    input: { path: 'docs/paper.pdf' },
    output: {
      status: 'success',
      kind: 'pdf',
      mediaType: 'application/pdf',
      pages: 15,
      byteSize: 2_215_244,
      path: '/work/docs/paper.pdf',
    },
    ...overrides,
  });

  const retainedRecord = {
    mediaType: 'application/pdf',
    data: Buffer.from('%PDF-').toString('base64'),
  };

  it.each([
    [
      'unstored',
      ['text', 'pdf'],
      { type: 'file-data', mediaType: 'application/pdf' },
    ],
    [
      'unstored',
      ['text'],
      {
        type: 'text',
        text: '[pdf "docs/paper.pdf" 15 pages, omitted: this model has no PDF input]',
      },
    ],
    [
      'stored',
      ['text', 'pdf'],
      { type: 'text', text: `[pdf ${MEDIA} unavailable]` },
    ],
  ] as const)(
    'replays a %s PDF with input=%j',
    async (form, input, expected) => {
      const stored = form === 'stored';
      const part = stored
        ? pdfPart({
            input: { path: MEDIA },
            output: {
              status: 'success',
              kind: 'pdf',
              media: MEDIA,
              mediaType: 'application/pdf',
              pages: 15,
              byteSize: 2_215_244,
              path: MEDIA,
            },
          })
        : pdfPart({ retainedMedia: retainedRecord });
      const projection = project([part]);
      const { resolver } = fakeResolver([]);
      for (const { retained } of projection) {
        if (retained !== undefined) {
          resolver.retainedMedia.set(retained.key, retained.entry);
        }
      }
      const composed = await composeStepMessages(pairMessages([part]), {
        resolver,
        context: {
          input,
          contextWindowTokens: 200_000,
          reservedOutputTokens: null,
        },
      });

      const message = composed.find((entry) => entry.role === 'tool');
      const replayed = message?.content[0];
      const output =
        replayed?.type === 'tool-result' ? replayed.output : undefined;
      if (expected.type === 'file-data') {
        expect(output).toMatchObject({
          type: 'content',
          value: [
            { type: 'text' },
            expect.objectContaining({ type: 'file-data' }),
          ],
        });
        return;
      }
      expect(toolOutputText(output)).toContain(expected.text);
    },
  );

  it('replays an unstored PDF without retained bytes as its text alone', () => {
    const output = projectOne(pdfPart()).pair.toolResultPart.output;

    expect(output).toMatchObject({ type: 'text' });
    const text = output.type === 'text' ? output.value : '';
    expect(text).toContain('docs/paper.pdf');
    expect(text).not.toContain('not retained');
  });
});
