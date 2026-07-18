export interface ModelSwitchPart {
  type: 'data-model-context';
  data: {
    kind: 'model_switch';
    fromModelId: string;
    toModelId: string;
    runId: string;
  };
}

export interface ClientTextPart {
  type: 'text';
  text: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...expectedKeys].sort().join('\0')
  );
}

/** Strict persisted-shape validation. Authoring remains server-only. */
export function isModelSwitchPart(value: unknown): value is ModelSwitchPart {
  if (!isExactRecord(value, ['type', 'data'])) {
    return false;
  }
  if (value.type !== 'data-model-context') {
    return false;
  }
  if (
    !isExactRecord(value.data, ['kind', 'fromModelId', 'toModelId', 'runId'])
  ) {
    return false;
  }

  const { kind, fromModelId, toModelId, runId } = value.data;
  return (
    kind === 'model_switch' &&
    typeof fromModelId === 'string' &&
    fromModelId.trim().length > 0 &&
    typeof toModelId === 'string' &&
    toModelId.trim().length > 0 &&
    fromModelId !== toModelId &&
    typeof runId === 'string' &&
    UUID_PATTERN.test(runId)
  );
}

/** The only application authoring path for trusted switch metadata. */
export function createModelSwitchPart(input: {
  fromModelId: string;
  toModelId: string;
  runId: string;
}): ModelSwitchPart {
  const part: ModelSwitchPart = {
    type: 'data-model-context',
    data: { kind: 'model_switch', ...input },
  };
  if (!isModelSwitchPart(part)) {
    throw new TypeError('Invalid server-authored model switch metadata');
  }
  return part;
}

/** Defense-in-depth for direct service callers that bypass the HTTP DTO. */
export function sanitizeClientMessageParts(
  parts: readonly unknown[],
): ClientTextPart[] {
  return parts.flatMap((part) => {
    if (
      typeof part !== 'object' ||
      part === null ||
      !('type' in part) ||
      part.type !== 'text' ||
      !('text' in part) ||
      typeof part.text !== 'string'
    ) {
      return [];
    }
    return [{ type: 'text' as const, text: part.text }];
  });
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function renderModelSwitchReminder(part: ModelSwitchPart): string {
  return [
    '<system-reminder>',
    'The active model changed before this user message.',
    `You are now running as model "${escapeXmlAttribute(part.data.toModelId)}".`,
    'Follow the current system instructions and continue the existing conversation.',
    'Do not restart, reintroduce yourself, or mention the model change unless the user asks.',
    '</system-reminder>',
  ].join('\n');
}
