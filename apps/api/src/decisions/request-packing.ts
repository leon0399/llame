/**
 * Request packing for the decision lane: greedy, contiguous, canonical-order
 * groups that fit a model's limits, measured by the decision-models estimate.
 */

import { type DecisionModelLimits } from '../instance-config/decision-catalog';
import {
  type DecisionQuestion,
  type DecisionQuestions,
  type DecisionState,
} from './decision-protocol';

/** A card as the wire sees it: positional key plus protected, final text. */
export type WireCard = { readonly key: string; readonly text: string };

/**
 * Greedy contiguous packing: each request takes the longest run of the next
 * cards that fits. A card that does not fit alone travels alone, cut to the
 * longest nonempty code-point prefix that fits; undefined means not even one
 * code point of a card fits beside the shared state.
 */
export function packCards(
  cards: ReadonlyArray<WireCard>,
  fits: (cards: ReadonlyArray<WireCard>) => boolean,
  maxCards: number,
): Array<Array<WireCard>> | undefined {
  const groups: Array<Array<WireCard>> = [];
  let start = 0;

  while (start < cards.length) {
    const length = longestFittingRun(cards, start, fits, maxCards);

    if (length > 0) {
      groups.push(cards.slice(start, start + length));
      start += length;
      continue;
    }

    const card = cards[start];

    const cut =
      card === undefined ? undefined : longestFittingPrefix(card, fits);

    if (cut === undefined) return undefined;
    groups.push([cut]);
    start += 1;
  }

  return groups;
}

/**
 * Binary search for the longest run from `start` that fits. Fitting is
 * monotone in the run length, because each added card only grows the state
 * and the questions, so this equals adding cards one by one at about log2(32)
 * request builds per group instead of one per card.
 */
function longestFittingRun(
  cards: ReadonlyArray<WireCard>,
  start: number,
  fits: (cards: ReadonlyArray<WireCard>) => boolean,
  maxCards: number,
): number {
  let low = 0;
  let high = Math.min(maxCards, cards.length - start);

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);

    if (fits(cards.slice(start, start + middle))) low = middle;
    else high = middle - 1;
  }

  return low;
}

/** Binary search over code points for the longest nonempty prefix that fits alone. */
function longestFittingPrefix(
  card: WireCard,
  fits: (cards: ReadonlyArray<WireCard>) => boolean,
): WireCard | undefined {
  const codePoints = Array.from(card.text);

  const withLength = (length: number) => ({
    key: card.key,
    text: codePoints.slice(0, length).join(''),
  });

  if (codePoints.length === 0 || !fits([withLength(1)])) return undefined;
  let low = 1;
  let high = codePoints.length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);

    if (fits([withLength(middle)])) low = middle;
    else high = middle - 1;
  }

  return withLength(low);
}

/** UTF-8 bytes of a value's `JSON.stringify` output. */
function serializedBytes(
  value: DecisionState | DecisionQuestions | DecisionQuestion,
): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * The decision-models estimate: summed UTF-8 bytes of the serialized JSON,
 * divided by 3 and rounded up. No tokenizer for these models ships in llame,
 * so this is a heuristic; a server truncation report is the backstop.
 */
export function estimatedTokens(bytes: number): number {
  return Math.ceil(bytes / 3);
}

export function fitsLimits(
  request: {
    readonly state: DecisionState;
    readonly questions: DecisionQuestions;
  },
  limits: DecisionModelLimits,
): boolean {
  const state = serializedBytes(request.state);

  const largestQuestion = Math.max(
    0,
    ...Object.values(request.questions).map(serializedBytes),
  );

  return (
    estimatedTokens(state + largestQuestion) <=
      limits.perQuestionContextTokens &&
    estimatedTokens(state + serializedBytes(request.questions)) <=
      limits.perRequestContextTokens
  );
}
