import { isCompletedAssistantTurn } from './chats-repository';
import { isTextPart } from './context-builder';

/**
 * The canonical visible source text for one immutable conversation message.
 * Stored text is preserved exactly; only the separator between text parts is
 * authored by this projection.
 */
export function visibleMessageText(parts: readonly unknown[]): string {
  return parts
    .filter(isTextPart)
    .map((part) => part.text)
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
