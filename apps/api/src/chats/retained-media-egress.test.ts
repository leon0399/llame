import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';
import {
  withoutRetainedMedia,
  withoutRetainedMediaPayload,
} from './retained-media-egress';

/** A retained image model variant, as a text-only model's read stores it. */
const RETAINED_IMAGE = {
  mediaType: 'image/png',
  width: 1600,
  height: 900,
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
};

/** A `tool-read` part as the live collector and the event-log rebuild store it. */
const TOOL_READ_PART = {
  type: 'tool-read',
  toolCallId: 'call-1',
  state: 'output-available',
  input: { path: '/work/shot.png' },
  output: {
    kind: 'image',
    mediaType: 'image/png',
    width: 1600,
    height: 900,
    path: '/work/shot.png',
    thumbnail: 'data:image/webp;base64,AAAA',
  },
  retainedMedia: RETAINED_IMAGE,
};

/** The stored part without its bytes: what every client must receive. */
const TOOL_READ_PART_WITHOUT_BYTES = {
  type: 'tool-read',
  toolCallId: 'call-1',
  state: 'output-available',
  input: { path: '/work/shot.png' },
  output: TOOL_READ_PART.output,
};

/** The import entry that kept its bytes, and one that never had any. */
const KEPT_ENTRY = {
  locator: 'shot.png',
  outcome: 'imported',
  width: 1600,
  height: 900,
  mediaType: 'image/png',
  retainedMedia: RETAINED_IMAGE,
};
const PLAIN_ENTRY = { locator: 'notes.md', outcome: 'imported' };

/** A `prompt-imports` item holding both entries. */
function promptImportsPart(): UnknownRecord {
  return {
    type: 'data-context',
    data: {
      v: 1,
      producer: 'prompt-imports',
      form: 'notice',
      text: 'Imported 2 targets.',
      payload: { imports: [KEPT_ENTRY, PLAIN_ENTRY] },
    },
  };
}

/** The given value as a JSON record, or a failure that names the shape. */
function recordOf(value: unknown): UnknownRecord {
  if (!isRecord(value)) {
    throw new Error('Expected a JSON object');
  }
  return value;
}

/** The `data.payload.imports` of a stored `data-context` part. */
function storedImports(part: UnknownRecord): Array<unknown> {
  const data = recordOf(part['data']);
  const imports = recordOf(data['payload'])['imports'];
  if (!Array.isArray(imports)) {
    throw new Error('Expected an imports array');
  }
  return imports;
}

describe('withoutRetainedMedia', () => {
  it('removes a tool part’s retained bytes and changes nothing else', () => {
    const stripped = withoutRetainedMedia([TOOL_READ_PART]);

    expect(stripped[0]).toEqual(TOOL_READ_PART_WITHOUT_BYTES);
    // The stored part is never mutated: the same object is still persisted.
    expect(TOOL_READ_PART.retainedMedia).toEqual(RETAINED_IMAGE);
  });

  it('removes the retained bytes of each prompt-import entry', () => {
    const part = promptImportsPart();
    const stored = storedImports(part);

    const strippedPart = recordOf(withoutRetainedMedia([part])[0]);
    const imports = storedImports(strippedPart);

    expect(imports[0]).toEqual({
      locator: 'shot.png',
      outcome: 'imported',
      width: 1600,
      height: 900,
      mediaType: 'image/png',
    });
    // An entry without bytes keeps its identity, and so does the stored part.
    expect(imports[1]).toBe(stored[1]);
    expect(stored[0]).toBe(KEPT_ENTRY);
    expect(JSON.stringify(strippedPart)).not.toContain(RETAINED_IMAGE.data);
  });

  it('leaves parts of another producer and parts without bytes untouched', () => {
    const parts: Array<unknown> = [
      { type: 'text', text: 'hello' },
      {
        type: 'data-context',
        data: {
          v: 1,
          producer: 'temporal',
          form: 'snapshot',
          text: 'now',
          payload: { instant: '2026-10-28T00:00:00.000Z' },
        },
      },
    ];

    expect(withoutRetainedMedia(parts)).toBe(parts);
  });
});

describe('withoutRetainedMediaPayload', () => {
  it('removes a tool.completed payload’s retained bytes beside its output', () => {
    const output = { kind: 'image', path: '/work/shot.png' };
    const payload = {
      toolCallId: 'call-1',
      toolName: 'read',
      output,
      retainedMedia: RETAINED_IMAGE,
    };

    expect(withoutRetainedMediaPayload('tool.completed', payload)).toEqual({
      toolCallId: 'call-1',
      toolName: 'read',
      output,
    });
    expect(payload.retainedMedia).toEqual(RETAINED_IMAGE);
  });

  it('removes a run.continued payload’s bytes from its kept parts', () => {
    const textPart = { type: 'text', text: 'kept' };
    const payload = { runId: 'run-1', parts: [TOOL_READ_PART, textPart] };

    const stripped = withoutRetainedMediaPayload('run.continued', payload);
    const parts = stripped['parts'];
    if (!Array.isArray(parts)) {
      throw new Error('Expected the kept parts');
    }

    expect(parts[0]).toEqual(TOOL_READ_PART_WITHOUT_BYTES);
    expect(parts[1]).toBe(textPart);
    expect(JSON.stringify(stripped)).not.toContain(RETAINED_IMAGE.data);
    // The stored payload keeps its bytes: the next attempt replays them.
    expect(payload.parts[0]).toBe(TOOL_READ_PART);
  });

  it('returns the stored payload by identity when it carries no bytes', () => {
    const payload = { runId: 'run-1', parts: [{ type: 'text', text: 'kept' }] };

    expect(withoutRetainedMediaPayload('run.continued', payload)).toBe(payload);
    expect(withoutRetainedMediaPayload('run.completed', {})).toEqual({});
  });
});
