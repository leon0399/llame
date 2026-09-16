import { loadPackagedTemplate } from '../prompts/template-engine';
import { isCompletedAssistantTurn } from './assistant-completion';
import { isTextPart } from './context-builder';

/**
 * Historical conversation bytes are data, not a new instruction or authority.
 * Search composes its discovery-specific guidance around this same framing;
 * exact reads return this closed notice directly. The two sentences are
 * template text in `prompts/conversation-history-notice.md`, duplicated
 * verbatim in the search-result notice template (two occurrences, under the
 * rule of three); the literal pins on both exported notices guard the drift.
 */
const renderConversationHistoryNotice = loadPackagedTemplate<
  Record<string, never>
>(__dirname, 'conversation-history-notice');

export const CONVERSATION_HISTORY_NOTICE = renderConversationHistoryNotice({});

/**
 * The canonical visible source text for one immutable conversation message.
 * Stored text is preserved exactly; only the separator between text parts is
 * authored by this projection.
 */
export function visibleMessageText(parts: ReadonlyArray<unknown>): string {
  return parts
    .flatMap((part) => (isTextPart(part) ? [part.text] : []))
    .join('\n\n');
}

/**
 * Identifies rows whose visible text can be used as immutable conversation
 * evidence. Legacy assistant rows with no completion status remain eligible;
 * the existing completion classifier defines that compatibility behavior.
 */
export function isImmutableEvidenceMessage(message: {
  role: string;
  usage?: unknown;
}): boolean {
  return message.role === 'user'
    ? true
    : message.role === 'assistant' && isCompletedAssistantTurn(message);
}
