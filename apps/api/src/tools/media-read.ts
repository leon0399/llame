import {
  MEDIA_SELECTOR_MESSAGE,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';

import { parseMediaLocator } from '../media/media-locator';
import type { ToolMediaStore } from '../media/tool-media-store';
import type { ToolResult } from './types';

function refusal(type: string, message: string): ToolResult {
  return { status: 'error', type, message };
}

/**
 * A `media://<id>` read (vision-media D4, D7): the Run owner's stored image,
 * returned as an image result whose `media` and `path` are the locator. It
 * binds no executor, stores nothing, and changes nothing. A malformed or bare
 * locator, then any selector, is refused before the lookup; another owner's
 * id and an unknown id are the same `not_found`. `edit` and `write` are
 * refused without a lookup.
 */
export async function executeMediaRead(
  media: ToolMediaStore,
  operation: 'read' | 'edit' | 'write',
  submitted: string,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  if (operation !== 'read') {
    return refusal(
      'unsupported_operation',
      'Media locators are read-only; edit and write cannot target them.',
    );
  }
  const { path, selector } = splitSelectorSuffix(submitted);
  const id = parseMediaLocator(path);
  if (id === undefined) {
    return refusal(
      'invalid_path',
      'A media locator is media:// followed by a lower-case UUID.',
    );
  }
  if (selector !== undefined) {
    return refusal('invalid_selector', MEDIA_SELECTOR_MESSAGE);
  }
  signal?.throwIfAborted();
  const found = await media.findMedia(id);
  if (found === undefined) return refusal('not_found', 'Media not found.');
  return { ...found, path };
}
