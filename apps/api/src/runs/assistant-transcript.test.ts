import {
  createAssistantPartCollector,
  reconstructDurableAssistant,
  toolActivityPart,
  type ToolActivityPart,
} from './assistant-transcript';
import { projectToolObservations } from '../chats/tool-observation-part';
import {
  REJECTED_HOP_MESSAGE,
  REJECTED_URL_BOUND,
  rejectedHopUrl,
} from '../tools/permissions/messages';
import type { RunEvent } from '../db/schema';
import type { ToolResult } from '../tools/types';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const timestamp = new Date('2026-09-02T12:00:00.000Z');

// eslint-disable-next-line anti-slop/no-unknown-parameters -- test fixture intentionally feeds malformed and valid persisted payload shapes through the replay boundary.
function event(eventType: string, payload: unknown): RunEvent {
  return {
    sequence: 1,
    runId: RUN_ID,
    eventType,
    payload,
    createdAt: timestamp,
  };
}

function successToolPart(toolCallId: string): ToolActivityPart {
  return {
    type: 'tool-search',
    toolCallId,
    state: 'output-available',
    input: { query: 'needle' },
    output: { status: 'success', value: 'found' },
    outcome: 'success',
  };
}

function errorToolPart(
  toolCallId: string,
  errorText = 'failed',
  outcome = 'error',
): ToolActivityPart {
  return {
    type: 'tool-search',
    toolCallId,
    state: 'output-error',
    input: { query: 'needle' },
    errorText,
    outcome,
  };
}

describe('AssistantPartCollector', () => {
  it('ignores empty fragments and merges adjacent text/reasoning fragments', () => {
    const collector = createAssistantPartCollector();

    collector.text('');
    collector.text('hello ');
    collector.text('world');
    collector.reasoning('');
    collector.reasoning('think ');
    collector.reasoning('more');

    expect(collector.parts()).toEqual([
      { type: 'text', text: 'hello world' },
      { type: 'reasoning', text: 'think more' },
    ]);
  });

  it('stores opaque provider metadata on the part its adapter id names', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('first summary', 'rs_1:0');
    collector.reasoning('second summary', 'rs_1:1');
    // The Responses adapter ends an earlier summary of the same reasoning
    // item when the next one opens, so both ends can arrive after the later
    // part already collected text; the id decides the target part.
    collector.reasoning('', 'rs_1:0', { openai: { itemId: 'rs_1' } });
    collector.reasoning('', 'rs_1:1', {
      openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
    });

    expect(collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: 'first summary',
        providerMetadata: { openai: { itemId: 'rs_1' } },
      },
      {
        type: 'reasoning',
        text: 'second summary',
        providerMetadata: {
          openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
        },
      },
    ]);
  });

  it('binds metadata without a part id to the open reasoning part', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('wire without ids');
    collector.reasoning('', undefined, { openai: { itemId: 'rs_1' } });

    expect(collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: 'wire without ids',
        providerMetadata: { openai: { itemId: 'rs_1' } },
      },
    ]);
  });

  it('leaves a reasoning part without metadata exactly as it was', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('plain thinking', 'reasoning-0');
    // An empty delivery with no metadata says nothing and adds no part.
    collector.reasoning('', 'reasoning-0');

    // `toStrictEqual` (not `toEqual`): an explicit `providerMetadata:
    // undefined` key would fail here, and the shape must be unchanged.
    expect(collector.parts()).toStrictEqual([
      { type: 'reasoning', text: 'plain thinking' },
    ]);
  });

  it('starts an empty part for a metadata-only delivery under an id nothing carries (D18)', () => {
    const collector = createAssistantPartCollector();
    const redacted = { anthropic: { redactedData: 'REDACTED_BLOCK' } };
    const signature = { anthropic: { signature: 'SIG_WITHHELD' } };

    // A redacted block: its payload rides the start, and no text exists. A
    // withheld block is the same shape one delivery later — an empty delta
    // carrying the signature. Both are blocks a later request must replay,
    // so each persists as its own empty part, in order.
    collector.reasoning('', '0:0', redacted);
    collector.reasoning('', '0:1', signature);

    expect(collector.parts()).toStrictEqual([
      { type: 'reasoning', text: '', providerMetadata: redacted },
      { type: 'reasoning', text: '', providerMetadata: signature },
    ]);

    // The empty part is the open one: text the wire still sends under that id
    // lands in it rather than opening another part.
    collector.reasoning(' after the fact', '0:1');
    expect(collector.parts()).toStrictEqual([
      { type: 'reasoning', text: '', providerMetadata: redacted },
      {
        type: 'reasoning',
        text: ' after the fact',
        providerMetadata: signature,
      },
    ]);
  });

  it('starts no part for an empty delivery that carries no provider metadata (D18)', () => {
    const collector = createAssistantPartCollector();
    const signature = { anthropic: { signature: 'SIG_WITHHELD' } };

    collector.reasoning('visible thinking', 'reasoning-0');
    // No text and no metadata: the delivery says nothing at all, so an id no
    // collected part carries must not open an empty part — a block exists to
    // persist only once its metadata arrives (design D18).
    collector.reasoning('', 'reasoning-1');

    expect(collector.parts()).toStrictEqual([
      { type: 'reasoning', text: 'visible thinking' },
    ]);

    // The metadata under that same id is what starts the part, behind the
    // text that already preceded it.
    collector.reasoning('', 'reasoning-1', signature);
    expect(collector.parts()).toStrictEqual([
      { type: 'reasoning', text: 'visible thinking' },
      { type: 'reasoning', text: '', providerMetadata: signature },
    ]);
  });

  it('filters unresolved requests but preserves an unrequested settlement', () => {
    const collector = createAssistantPartCollector();

    collector.toolRequested('pending');
    collector.tool(successToolPart('unrequested'));

    expect(collector.parts()).toEqual([successToolPart('unrequested')]);
  });

  it('keeps the first settlement and removes the pending index after replacement', () => {
    const collector = createAssistantPartCollector();
    const first = errorToolPart('call-1', 'cancelled', 'cancelled');

    collector.toolRequested('call-1');
    collector.tool(first);
    collector.tool(successToolPart('call-1'));

    expect(collector.parts()).toEqual([first]);
  });

  it('persists every reasoning part whole past the former persistence cap', () => {
    const collector = createAssistantPartCollector();
    // Both parts individually exceed the deleted 24,000-character cap.
    const first = 'x'.repeat(30_000);
    const second = 'y'.repeat(30_000);

    collector.reasoning(first, 'rs_1:0');
    collector.reasoning(second, 'rs_1:1');

    const parts = collector.parts();
    expect(parts).toEqual([
      { type: 'reasoning', text: first },
      { type: 'reasoning', text: second },
    ]);
    // No truncation marker: the persisted text is the text the provider
    // produced, byte for byte (D9/D11 — replay signs or encrypts it).
    expect(JSON.stringify(parts)).not.toContain('…');
  });
});

describe('toolActivityPart', () => {
  it('shapes successful tool results without adding error metadata', () => {
    const result: ToolResult = { status: 'success', value: 'ok' };

    expect(
      toolActivityPart({
        toolCallId: 'call-1',
        toolName: 'search',
        input: { query: 'q' },
        result,
      }),
    ).toEqual({
      type: 'tool-search',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { query: 'q' },
      output: result,
      outcome: 'success',
    });
  });

  it('omits an empty derived-decision list', () => {
    const part = toolActivityPart({
      toolCallId: 'call-1',
      toolName: 'search',
      input: { query: 'q' },
      result: { status: 'success', value: 'ok' },
      derivedDecisions: [],
    });

    expect(part).not.toHaveProperty('derivedDecisions');
  });

  it.each([
    [
      'cancelled',
      { status: 'error', type: 'cancelled', message: 'stopped' },
      'cancelled',
    ],
    [
      'unknown type',
      { status: 'error', type: 'custom', message: 'failed' },
      'custom',
    ],
    ['empty type', { status: 'error', type: '', message: 'failed' }, 'error'],
  ] as const)(
    'shapes %s errors with the normalized outcome',
    (_name, result, outcome) => {
      const part = toolActivityPart({
        toolCallId: 'call-1',
        toolName: 'search',
        input: { query: 'q' },
        result,
      });

      expect(part).toMatchObject({
        type: 'tool-search',
        toolCallId: 'call-1',
        state: 'output-error',
        input: { query: 'q' },
        errorText: result.message,
        outcome,
      });
      if (result.type === 'cancelled') {
        expect(part.resultProviderMetadata).toEqual({
          llame: { cancelled: true },
        });
      } else {
        expect(part.resultProviderMetadata).toBeUndefined();
      }
    },
  );

  it('stores the refused target a hop rejection names beside its error', () => {
    const refusedUrl = 'https://blocked.example.test/page';
    const part = toolActivityPart({
      toolCallId: 'call-1',
      toolName: 'read',
      input: { path: 'https://docs.example.test/a' },
      result: {
        status: 'error',
        type: 'permission_denied',
        message: REJECTED_HOP_MESSAGE,
        rejectedUrl: refusedUrl,
      },
    });

    expect(part).toEqual({
      type: 'tool-read',
      toolCallId: 'call-1',
      state: 'output-error',
      input: { path: 'https://docs.example.test/a' },
      errorText: REJECTED_HOP_MESSAGE,
      outcome: 'permission_denied',
      errorRejectedUrl: refusedUrl,
    });
    // The locator rides beside the fixed message, never inside it.
    expect(part.errorText).not.toContain('blocked.example.test');
  });

  it('stores no refused target for an error that is not a hop rejection', () => {
    const part = toolActivityPart({
      toolCallId: 'call-1',
      toolName: 'search',
      input: { query: 'q' },
      result: {
        status: 'error',
        type: 'network_error',
        message: 'failed',
        rejectedUrl: 'https://blocked.example.test/page',
      },
    });

    expect(part).not.toHaveProperty('errorRejectedUrl');
  });

  it('stores no refused target for another tool that reports a permission denial', () => {
    const part = toolActivityPart({
      toolCallId: 'call-1',
      toolName: 'knowledge_search',
      input: { query: 'q' },
      result: {
        status: 'error',
        type: 'permission_denied',
        message: 'rejected',
        rejectedUrl: 'https://blocked.example.test/page',
      },
    });

    expect(part).not.toHaveProperty('errorRejectedUrl');
  });
});

describe('reconstructDurableAssistant', () => {
  it('replays text, reasoning, cap notices, and unknown events in event order', () => {
    const result = reconstructDurableAssistant([
      event('model.delta', { text: 'answer ' }),
      event('model.delta', { text: 'text' }),
      event('reasoning.delta', { text: 'think' }),
      event('run.step_cap_reached', { stepsUsed: 4, maxSteps: 4 }),
      event('ignored.event', { text: 'not persisted' }),
      event('model.delta', null),
      event('reasoning.delta', { text: 3 }),
    ]);

    expect(result.collector.parts()).toEqual([
      { type: 'text', text: 'answer text' },
      { type: 'reasoning', text: 'think' },
      { type: 'data-cap-notice', data: { stepsUsed: 4, maxSteps: 4 } },
    ]);
    expect(result.openToolCalls).toEqual(new Map());
  });

  it('rebuilds reasoning part boundaries from the persisted adapter part ids', () => {
    const result = reconstructDurableAssistant([
      event('reasoning.delta', { text: 'first ', partId: 'rs_1:0' }),
      event('reasoning.delta', { text: 'summary', partId: 'rs_1:0' }),
      event('reasoning.delta', { text: 'second', partId: 'rs_1:1' }),
      event('tool.requested', {
        toolCallId: 'c1',
        toolName: 'search',
        input: { query: 'needle' },
      }),
      event('tool.completed', {
        toolCallId: 'c1',
        output: { status: 'success', value: 'found' },
      }),
      event('reasoning.delta', { text: 'after the tool', partId: 'rs_1:1' }),
      event('model.delta', { text: 'answer' }),
    ]);

    expect(result.collector.parts()).toEqual([
      { type: 'reasoning', text: 'first summary' },
      { type: 'reasoning', text: 'second' },
      expect.objectContaining({ type: 'tool-search', toolCallId: 'c1' }),
      { type: 'reasoning', text: 'after the tool' },
      { type: 'text', text: 'answer' },
    ]);
  });

  it('replays each reasoning part’s provider metadata onto its own part', () => {
    const earlierMetadata = { openai: { itemId: 'rs_1' } };
    const laterMetadata = {
      openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
    };
    const result = reconstructDurableAssistant([
      event('reasoning.delta', { text: 'first summary', partId: 'rs_1:0' }),
      event('reasoning.delta', { text: 'second summary', partId: 'rs_1:1' }),
      // The ends arrive after the later part already holds text; the id
      // routes each one to the part it belongs to.
      event('reasoning.delta', {
        partId: 'rs_1:0',
        providerMetadata: earlierMetadata,
      }),
      event('reasoning.delta', {
        partId: 'rs_1:1',
        providerMetadata: laterMetadata,
      }),
      // A malformed payload binds nothing and adds no part.
      event('reasoning.delta', {
        partId: 'rs_1:1',
        providerMetadata: 'not-a-record',
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: 'first summary',
        providerMetadata: earlierMetadata,
      },
      {
        type: 'reasoning',
        text: 'second summary',
        providerMetadata: laterMetadata,
      },
    ]);
  });

  it('starts an empty part for a metadata-only event whose id the log never carried (D18)', () => {
    const withheld = { anthropic: { signature: 'SIG_WITHHELD' } };
    const result = reconstructDurableAssistant([
      event('model.delta', { text: 'the answer so far' }),
      // A block whose text the provider withheld: the run records its
      // metadata under an id no earlier event carried, so the replay must
      // rebuild the empty part and its bound metadata behind the text.
      event('reasoning.delta', { partId: '0:0', providerMetadata: withheld }),
      // A later delivery naming that part binds to it instead of starting a
      // second one; one carrying no metadata changes nothing.
      event('reasoning.delta', { partId: '0:0' }),
      event('reasoning.delta', { partId: '0:0', providerMetadata: withheld }),
    ]);

    expect(result.collector.parts()).toStrictEqual([
      { type: 'text', text: 'the answer so far' },
      { type: 'reasoning', text: '', providerMetadata: withheld },
    ]);
  });

  it('merges legacy reasoning.delta events that carry no part id', () => {
    const result = reconstructDurableAssistant([
      event('reasoning.delta', { text: 'one ' }),
      event('reasoning.delta', { text: 'thought' }),
      // Absent after a defined id is not a boundary either.
      event('reasoning.delta', { text: ' second', partId: 'rs_1:0' }),
      event('reasoning.delta', { text: ' third' }),
    ]);

    expect(result.collector.parts()).toEqual([
      { type: 'reasoning', text: 'one thought second third' },
    ]);
  });

  it('replays a reasoning part longer than the former cap whole', () => {
    const long = 'z'.repeat(30_000);
    const result = reconstructDurableAssistant([
      event('reasoning.delta', { text: long, partId: 'rs_1:0' }),
    ]);

    const parts = result.collector.parts();
    expect(parts).toEqual([{ type: 'reasoning', text: long }]);
    expect(JSON.stringify(parts)).not.toContain('…');
  });

  it('reserves requested tools, correlates completions, and keeps occurrence order', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'first',
        toolName: 'search',
        input: { query: 'first' },
      }),
      event('tool.requested', {
        toolCallId: 'second',
        toolName: 'lookup',
        input: { query: 'second' },
      }),
      event('tool.completed', {
        toolCallId: 'second',
        output: { status: 'success', value: 'two' },
      }),
      event('tool.completed', {
        toolCallId: 'first',
        output: { status: 'error', type: 'cancelled', message: 'stopped' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'tool-search',
        toolCallId: 'first',
        state: 'output-error',
        input: { query: 'first' },
        errorText: 'stopped',
        outcome: 'cancelled',
        resultProviderMetadata: { llame: { cancelled: true } },
      },
      {
        type: 'tool-lookup',
        toolCallId: 'second',
        state: 'output-available',
        input: { query: 'second' },
        output: { status: 'success', value: 'two' },
        outcome: 'success',
      },
    ]);
    expect(result.openToolCalls).toEqual(new Map());
  });

  it('carries safe permission metadata from request to stored part', () => {
    const permission = {
      policyId: 'policy-1',
      decision: 'reject' as const,
      reason: 'explicit_reject' as const,
      reference: { groupId: 'bash', list: 'reject' as const, clauseIndex: 0 },
    };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { command: 'git push' },
        permission,
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: {
          status: 'error',
          type: 'permission_denied',
          message: 'rejected',
        },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'tool-bash',
        toolCallId: 'call-1',
        state: 'output-error',
        input: { command: 'git push' },
        errorText: 'rejected',
        outcome: 'permission_denied',
        permission,
      },
    ]);
  });

  it('ignores malformed permission metadata', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'bash',
        input: {},
        permission: { policyId: 1, decision: 'maybe' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([]);
    expect([...result.openToolCalls.values()][0]?.permission).toBeUndefined();
  });

  it('carries derived-locator decisions from the completion payload to the stored part', () => {
    const permission = {
      policyId: 'policy-1',
      decision: 'allow' as const,
      reason: 'matched_allow' as const,
      reference: { groupId: 'read', list: 'allow' as const, clauseIndex: null },
    };
    const derivedDecisions = [
      { ...permission, kind: 'alternate' as const },
      {
        kind: 'suffix' as const,
        policyId: 'policy-1',
        decision: 'reject' as const,
        reason: 'no_allow' as const,
        reference: { groupId: 'read', list: 'allow' as const, clauseIndex: 0 },
      },
    ];
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: 'https://docs.example.test/a/b' },
        permission,
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success', content: 'body' },
        derivedDecisions,
      }),
    ]);

    // The call decision comes from the request, the derived ones from the
    // completion the executor's decisions settled with.
    expect(result.collector.parts()).toEqual([
      {
        type: 'tool-read',
        toolCallId: 'call-1',
        state: 'output-available',
        input: { path: 'https://docs.example.test/a/b' },
        output: { status: 'success', content: 'body' },
        outcome: 'success',
        permission,
        derivedDecisions,
      },
    ]);
  });

  it('drops malformed derived-locator decisions and keeps the valid ones', () => {
    const valid = {
      kind: 'hop' as const,
      policyId: 'policy-1',
      decision: 'reject' as const,
      reason: 'no_allow' as const,
      reference: null,
    };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: {},
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success' },
        derivedDecisions: [
          { policyId: 'policy-1', decision: 'maybe' },
          'not-a-record',
          // A sound decision still needs the kind of locator it judged: an
          // unknown or absent one is dropped rather than guessed at.
          { ...valid, kind: 'redirect' },
          { policyId: 'policy-1', decision: 'allow', reason: 'matched_allow' },
          valid,
        ],
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({ derivedDecisions: [valid] }),
    ]);
  });

  it.each([
    ['a non-array value', 'not-a-list'],
    ['an empty list', []],
    ['only malformed entries', [{ policyId: 1, decision: 'reject' }]],
  ])('records no derived decisions for %s', (_name, derivedDecisions) => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: {},
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success' },
        derivedDecisions,
      }),
    ]);

    expect(result.collector.parts()[0]).not.toHaveProperty('derivedDecisions');
  });

  it('bounds a stored derived-decision list to the per-call budget', () => {
    const decision = {
      kind: 'llms-txt' as const,
      policyId: 'policy-1',
      decision: 'allow' as const,
      reason: 'matched_allow' as const,
      reference: null,
    };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: {},
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success' },
        derivedDecisions: Array.from({ length: 30 }, () => decision),
      }),
    ]);

    const [part] = result.collector.parts();
    expect(part).toMatchObject({
      derivedDecisions: Array.from({ length: 26 }, () => decision),
    });
  });

  it('keeps derived-locator decisions out of the observable result and model replay', () => {
    const decision = {
      kind: 'hop' as const,
      policyId: 'policy-instance-7c1f',
      decision: 'reject' as const,
      reason: 'explicit_reject' as const,
      reference: null,
    };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: 'https://docs.example.test/a/b' },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success', content: 'body' },
        derivedDecisions: [decision],
      }),
    ]);
    const [part] = result.collector.parts();

    // The record appears once, in its own field: the observation the model
    // reads, a public share, an export, and search receive carries no policy
    // metadata of its own.
    expect(part).toMatchObject({ derivedDecisions: [decision] });
    expect(JSON.stringify(part).split('policy-instance-7c1f')).toHaveLength(2);
    // Model replay projects its own closed shape from the stored parts.
    expect(
      JSON.stringify(projectToolObservations(result.collector.parts())),
    ).not.toContain('policy-instance-7c1f');
  });

  it('reloads a refused hop target from storage and re-attaches it to model replay', () => {
    const refusedUrl = 'https://blocked.example.test/page';
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: 'https://docs.example.test/a' },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: {
          status: 'error',
          type: 'permission_denied',
          message: REJECTED_HOP_MESSAGE,
          rejectedUrl: refusedUrl,
        },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'tool-read',
        toolCallId: 'call-1',
        state: 'output-error',
        input: { path: 'https://docs.example.test/a' },
        errorText: REJECTED_HOP_MESSAGE,
        outcome: 'permission_denied',
        errorRejectedUrl: refusedUrl,
      },
    ]);
    // The next turn replays the part: the model reads the fixed message plus
    // the target it names, so the blocked locator stays identifiable.
    const serialized = JSON.stringify(
      projectToolObservations(result.collector.parts()),
    );
    expect(serialized).toContain(REJECTED_HOP_MESSAGE);
    expect(serialized).toContain(`rejectedUrl: ${refusedUrl}`);
  });

  it.each([
    [
      'the exact locator a hop rejection writes',
      rejectedHopUrl('https://blocked.example.test/page?token=secret#frag'),
      true,
    ],
    [
      'a locator exactly at the bound',
      `https://blocked.example.test/${'a'.repeat(
        REJECTED_URL_BOUND - 'https://blocked.example.test/'.length,
      )}`,
      true,
    ],
    ['a non-string value', 42, false],
    ['an empty string', '', false],
    [
      'a value past the bound',
      `https://blocked.example.test/${'a'.repeat(REJECTED_URL_BOUND)}`,
      false,
    ],
    [
      'a locator carrying userinfo',
      'https://user:secret@blocked.example.test/page',
      false,
    ],
    [
      'a locator carrying a query',
      'https://blocked.example.test/page?token=secret',
      false,
    ],
    [
      'a locator carrying a fragment',
      'https://blocked.example.test/page#frag',
      false,
    ],
    [
      'a locator carrying a control character',
      'https://blocked.example.test/pa\u0007ge',
      false,
    ],
    ['a non-web scheme', 'ftp://blocked.example.test/page', false],
    ['a relative locator', '/page', false],
    ['a noncanonical spelling', 'https://BLOCKED.example.test/page', false],
    [
      'an explicit default port',
      'https://blocked.example.test:443/page',
      false,
    ],
  ] as const)(
    're-reads %s from storage only while it is the exact locator a hop rejection writes',
    (_name, rejectedUrl, accepted) => {
      const result = reconstructDurableAssistant([
        event('tool.requested', {
          toolCallId: 'call-1',
          toolName: 'read',
          input: {},
        }),
        event('tool.completed', {
          toolCallId: 'call-1',
          output: {
            status: 'error',
            type: 'permission_denied',
            message: 'rejected',
            rejectedUrl,
          },
        }),
      ]);
      const [part] = result.collector.parts();

      expect(part).toMatchObject({ outcome: 'permission_denied' });
      if (accepted) {
        expect(part).toHaveProperty('errorRejectedUrl', rejectedUrl);
      } else {
        expect(part).not.toHaveProperty('errorRejectedUrl');
        expect(
          JSON.stringify(projectToolObservations(result.collector.parts())),
        ).not.toContain('rejectedUrl');
      }
    },
  );

  it.each([
    ['another tool', 'knowledge_search', 'permission_denied'],
    ['another error type', 'read', 'network_error'],
  ] as const)(
    're-reads no refused target from a completion recorded for %s',
    (_name, toolName, type) => {
      const result = reconstructDurableAssistant([
        event('tool.requested', { toolCallId: 'call-1', toolName, input: {} }),
        event('tool.completed', {
          toolCallId: 'call-1',
          output: {
            status: 'error',
            type,
            message: 'rejected',
            rejectedUrl: 'https://blocked.example.test/page',
          },
        }),
      ]);
      const [part] = result.collector.parts();

      expect(part).not.toHaveProperty('errorRejectedUrl');
      expect(
        JSON.stringify(projectToolObservations(result.collector.parts())),
      ).not.toContain('rejectedUrl');
    },
  );

  it('replays an ordinary error observation unchanged', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'search',
        input: { query: 'needle' },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: {
          status: 'error',
          type: 'timeout',
          message: 'Tool timed out.',
        },
      }),
    ]);
    const [part] = result.collector.parts();

    expect(part).not.toHaveProperty('errorRejectedUrl');
    const serialized = JSON.stringify(
      projectToolObservations(result.collector.parts()),
    );
    expect(serialized).toContain('Tool timed out.');
    expect(serialized).not.toContain('rejectedUrl');
  });

  it('ignores malformed, duplicate, and orphaned tool events while exposing open calls', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', { toolCallId: '', toolName: 'search' }),
      event('tool.requested', { toolCallId: 'call-1', toolName: '' }),
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'search',
        input: 1,
      }),
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'search',
        input: 2,
      }),
      event('tool.completed', {
        toolCallId: 'orphan',
        output: { status: 'success' },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'partial' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([]);
    expect(result.openToolCalls).toEqual(
      new Map([['call-1', { toolName: 'search', toolInput: 1 }]]),
    );
  });

  it('ignores duplicate completion and malformed step-cap payloads', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', { toolCallId: 'call-1', toolName: 'search' }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success', value: 'done' },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'error', type: 'late', message: 'late' },
      }),
      event('run.step_cap_reached', { stepsUsed: '4', maxSteps: 4 }),
      event('run.step_cap_reached', { stepsUsed: 4, maxSteps: 4 }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'tool-search',
        toolCallId: 'call-1',
        state: 'output-available',
        input: undefined,
        output: { status: 'success', value: 'done' },
        outcome: 'success',
      },
      { type: 'data-cap-notice', data: { stepsUsed: 4, maxSteps: 4 } },
    ]);
  });
});

describe('system-origin tool activity', () => {
  // Skill activation is llame's own read, not a call the model made. It is
  // recorded durably and excluded from the assistant transcript, so the model
  // never sees a fabricated call and the UI never replays one.
  const requested = (toolCallId: string) => ({
    toolCallId,
    toolName: 'read',
    input: { path: 'skill://pdf:raw' },
    origin: 'skill-activation',
  });

  it('produces no assistant part and no open call', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', requested('activation-1')),
      event('tool.completed', {
        toolCallId: 'activation-1',
        toolName: 'read',
        status: 'success',
        output: { status: 'success', content: 'instructions' },
        origin: 'skill-activation',
      }),
    ]);

    expect(result.collector.parts()).toEqual([]);
    // Nothing left open either: a system-origin request must not become a
    // synthesized settlement on recovery.
    expect(result.openToolCalls).toEqual(new Map());
  });

  it('leaves model-origin activity beside it untouched', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', requested('activation-1')),
      event('tool.completed', {
        toolCallId: 'activation-1',
        toolName: 'read',
        status: 'success',
        output: { status: 'success', content: 'instructions' },
        origin: 'skill-activation',
      }),
      event('tool.requested', {
        toolCallId: 'model-1',
        toolName: 'search',
        input: { query: 'needle' },
      }),
      event('tool.completed', {
        toolCallId: 'model-1',
        output: { status: 'success', value: 'found' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({ toolCallId: 'model-1' }),
    ]);
  });

  it('treats activity without an origin as model-origin', () => {
    // Legacy events predate the discriminator and must keep replaying as the
    // model's own calls.
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'legacy-1',
        toolName: 'search',
        input: { query: 'needle' },
      }),
      event('tool.completed', {
        toolCallId: 'legacy-1',
        output: { status: 'success', value: 'found' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({ toolCallId: 'legacy-1' }),
    ]);
  });

  it('ignores an unrecognized origin rather than trusting it', () => {
    // Only the shipped discriminator is system-origin; anything else is an
    // unknown value and stays model-origin rather than being silently treated
    // as llame's own activity.
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'other-1',
        toolName: 'search',
        input: { query: 'needle' },
        origin: 'some-other-caller',
      }),
      event('tool.completed', {
        toolCallId: 'other-1',
        output: { status: 'success', value: 'found' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({ toolCallId: 'other-1' }),
    ]);
  });
});
