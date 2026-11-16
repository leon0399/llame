import { neutralizeReservedDelimiters } from '@workspace/runtime-safety';

import { loadPackagedTemplate } from '../prompts/template-engine';
import { type AuthoredContextItemPart } from './context-item';
import { createRenderedContextItem } from './context-item-shared';

const renderCompactionContinue = loadPackagedTemplate<{
  readonly quote: string;
}>(__dirname, 'compaction-continue');

/** Create the host-message item that resumes work from a new checkpoint. */
export function createCompactionContinueItem({
  runId,
  quote,
}: {
  readonly runId: string;
  readonly quote: string | null;
}): AuthoredContextItemPart {
  const safeQuote =
    quote === null ? '' : capUtf16(neutralizeReservedDelimiters(quote));

  const body = renderCompactionContinue({ quote: safeQuote });

  return createRenderedContextItem({
    producer: 'compaction',
    form: 'notice',
    runId,
    payload: { quote: quote === null ? null : safeQuote },
    body,
  });
}

function capUtf16(value: string): string {
  const capped = value.slice(0, 4000);
  const last = capped.charCodeAt(capped.length - 1);

  return last >= 55_296 && last <= 56_319 ? capped.slice(0, -1) : capped;
}
