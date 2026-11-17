import {
  automaticBoundaryThresholdReached,
  compactionAttemptStarted,
} from './automatic-boundary-trigger';
import { estimateModelRequestTokens } from './compaction';
import type { ModelMessage } from '../chats/context-builder';
import { descriptor } from '../media/media-fixtures';
import type { MediaSizing } from '../media/epoch-admission';

describe('compaction attempt progress guard', () => {
  it('does not treat a woken attempt as the compaction attempt', () => {
    expect(
      compactionAttemptStarted({
        wakeCompaction: false,
        startsAfterCompaction: true,
        isWakeAttempt: true,
      }),
    ).toBe(false);
  });

  it('checks a requested wake compaction', () => {
    expect(
      compactionAttemptStarted({
        wakeCompaction: true,
        startsAfterCompaction: false,
        isWakeAttempt: true,
      }),
    ).toBe(true);
  });
});

describe('automatic boundary threshold', () => {
  const imageId = '0192f3a4-5b6c-7d8e-9f01-00000000000a';

  const media: MediaSizing = {
    descriptors: new Map([
      [
        imageId,
        descriptor(imageId, {
          width: 4000,
          height: 2250,
          modelWidth: 2000,
          modelHeight: 1125,
        }),
      ],
    ]),
    retained: new Map(),
    statuses: ['attached'],
    context: {
      input: ['text', 'image'],
      contextWindowTokens: 200_000,
      reservedOutputTokens: null,
    },
  };

  const imageResult: Array<ModelMessage> = [
    {
      role: 'user',
      content: [
        { type: 'file', data: `media://${imageId}`, mediaType: 'image/png' },
        { type: 'text', text: 'inspect this image' },
      ],
    },
  ];

  const stepToolResults: Array<ModelMessage> = [
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read',
          output: { type: 'text', value: 'a substantial result' },
        },
      ],
    },
  ];

  it('adds only the current step result to a counted request receipt', () => {
    const addedTokens = estimateModelRequestTokens({
      messages: stepToolResults,
      toolDeclarations: [],
    });

    expect(
      automaticBoundaryThresholdReached({
        latestRequestContextTokens: 100,
        system: 'not counted again',
        requestMessages: [{ role: 'user', content: 'not counted again' }],
        stepToolResults,
        toolDeclarations: [],
        thresholdTokens: 100 + addedTokens,
      }),
    ).toBe(true);

    expect(
      automaticBoundaryThresholdReached({
        latestRequestContextTokens: 100,
        system: '',
        requestMessages: [],
        stepToolResults,
        toolDeclarations: [],
        thresholdTokens: 101 + addedTokens,
      }),
    ).toBe(false);
  });

  it('charges attached media in a counted step result', () => {
    const withoutMediaTokens = estimateModelRequestTokens({
      messages: imageResult,
      toolDeclarations: [],
    });

    const withMediaTokens = estimateModelRequestTokens({
      messages: imageResult,
      toolDeclarations: [],
      media,
    });

    expect(withMediaTokens).toBeGreaterThan(withoutMediaTokens);
    expect(
      automaticBoundaryThresholdReached({
        latestRequestContextTokens: 100,
        system: '',
        requestMessages: [],
        stepToolResults: imageResult,
        toolDeclarations: [],
        stepToolResultMedia: media,
        thresholdTokens: 100 + withMediaTokens,
      }),
    ).toBe(true);
  });

  it('charges attached media in the next request when there is no receipt', () => {
    const withoutMediaTokens = estimateModelRequestTokens({
      system: 'system prompt',
      messages: imageResult,
      toolDeclarations: [],
    });

    const withMediaTokens = estimateModelRequestTokens({
      system: 'system prompt',
      messages: imageResult,
      toolDeclarations: [],
      media,
    });

    expect(withMediaTokens).toBeGreaterThan(withoutMediaTokens);
    expect(
      automaticBoundaryThresholdReached({
        system: 'system prompt',
        requestMessages: imageResult,
        stepToolResults: [],
        toolDeclarations: [],
        nextRequestMedia: media,
        thresholdTokens: withMediaTokens,
      }),
    ).toBe(true);
  });

  it('estimates the complete next request when no receipt is available', () => {
    const input = {
      system: 'system prompt',
      requestMessages: [
        { role: 'user', content: 'request' },
      ] satisfies Array<ModelMessage>,
      stepToolResults,
      toolDeclarations: [
        {
          id: 'lookup',
          description: 'Look up the supplied query.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
          },
        },
      ],
    };

    const wholeRequestTokens = estimateModelRequestTokens({
      system: input.system,
      messages: [...input.requestMessages, ...input.stepToolResults],
      toolDeclarations: input.toolDeclarations,
    });

    expect(
      automaticBoundaryThresholdReached({
        ...input,
        thresholdTokens: wholeRequestTokens,
      }),
    ).toBe(true);

    expect(
      automaticBoundaryThresholdReached({
        ...input,
        thresholdTokens: wholeRequestTokens + 1,
      }),
    ).toBe(false);
  });
});

describe('compaction attempt progress guard', () => {
  it.each([
    [false, false, false, false],
    [true, false, true, false],
    [false, false, true, true],
    [true, true, false, false],
    [true, true, false, true],
    [true, true, true, false],
    [true, true, true, true],
  ])(
    'returns %s for wake=%s, previous compaction=%s, and wake attempt=%s',
    (expected, wakeCompaction, startsAfterCompaction, isWakeAttempt) => {
      expect(
        compactionAttemptStarted({
          wakeCompaction,
          startsAfterCompaction,
          isWakeAttempt,
        }),
      ).toBe(expected);
    },
  );
});
