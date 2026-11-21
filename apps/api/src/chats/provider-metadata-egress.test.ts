import { withoutProviderMetadataPayload } from './provider-metadata-egress';

/** The opaque continuation state a Responses-wire adapter attaches to a call. */
const PROVIDER_METADATA = {
  openai: { itemId: 'rs_68a1', reasoningEncryptedContent: 'gAAAAAB' },
};

/** A `tool-read` part as the live collector stores an adapter's call. */
const TOOL_READ_PART = {
  type: 'tool-read',
  toolCallId: 'call-1',
  state: 'output-available',
  input: { path: 'notes.txt' },
  output: { status: 'success', text: 'kept result' },
  outcome: 'success',
  providerMetadata: PROVIDER_METADATA,
};

/** The stored part without its metadata: what every client must receive. */
const TOOL_READ_PART_WITHOUT_METADATA = {
  type: 'tool-read',
  toolCallId: 'call-1',
  state: 'output-available',
  input: { path: 'notes.txt' },
  output: { status: 'success', text: 'kept result' },
  outcome: 'success',
};

describe('withoutProviderMetadataPayload', () => {
  it('removes a run.suspended payload’s part metadata from its kept parts', () => {
    const textPart = { type: 'text', text: 'kept' };

    const payload = {
      attemptId: 'attempt-1',
      kind: 'quota',
      parts: [TOOL_READ_PART, textPart],
      steps: {},
    };

    const stripped = withoutProviderMetadataPayload('run.suspended', payload);
    const parts = stripped['parts'];

    if (!Array.isArray(parts)) {
      throw new Error('Expected the kept parts');
    }

    expect(parts[0]).toEqual(TOOL_READ_PART_WITHOUT_METADATA);
    // A part that carries no metadata keeps its identity.
    expect(parts[1]).toBe(textPart);
    expect(JSON.stringify(stripped)).not.toContain(
      PROVIDER_METADATA.openai.itemId,
    );
    // The stored payload keeps its metadata: the next attempt replays it.
    expect(payload.parts[0]).toBe(TOOL_READ_PART);
  });
});
