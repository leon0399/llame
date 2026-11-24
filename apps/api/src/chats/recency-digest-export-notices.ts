import { isRecord, isString } from '@workspace/runtime-safety';

import { isContextItemPart } from './context-item';
import { isRecencyDigestDeltaPayload } from './recency-digest-item';

type PinCorrection = { title: string; pinned: boolean };

type PinEvidenceState = {
  pinCorrections: Array<PinCorrection>;
  pinCorrectionUnproved: boolean;
};

type RecencyNoticeEvidence =
  | { form: 'snapshot' }
  | { form: 'notice'; pinChanges: ReadonlyArray<PinCorrection> }
  | { form: 'unproved' };

/** Validate one stored envelope before interpreting any digest metadata. */
function readRecencyNoticeEvidence(
  candidate: unknown,
): RecencyNoticeEvidence | undefined {
  if (!isRecord(candidate)) return undefined;

  const rawData = candidate['data'];

  if (!isRecord(rawData) || rawData['producer'] !== 'recency-digest')
    return undefined;

  if (!isContextItemPart(candidate)) return { form: 'unproved' };

  const { data } = candidate;

  if (!isString(data.text) || data.text.trim().length === 0)
    return { form: 'unproved' };

  if (data.form === 'snapshot')
    return Object.keys(data.payload).length === 0
      ? { form: 'snapshot' }
      : { form: 'unproved' };

  if (data.form !== 'notice' || !isRecencyDigestDeltaPayload(data.payload))
    return { form: 'unproved' };

  return { form: 'notice', pinChanges: data.payload.pinChanges };
}

/** Apply validated notice events in the message's persisted part order. */
function applyRecencyNoticeEvidence(
  evidence: RecencyNoticeEvidence,
  state: PinEvidenceState,
): void {
  if (evidence.form === 'snapshot') {
    state.pinCorrections = [];
    state.pinCorrectionUnproved = false;

    return;
  }

  if (evidence.form === 'unproved') {
    state.pinCorrections = [];
    state.pinCorrectionUnproved = true;

    return;
  }

  if (!state.pinCorrectionUnproved)
    state.pinCorrections.push(...evidence.pinChanges);
}

export function collectPinCorrectionsFromMessage(
  message: { parts: ReadonlyArray<unknown> },
  state: PinEvidenceState,
): void {
  for (const candidate of message.parts) {
    const evidence = readRecencyNoticeEvidence(candidate);

    if (evidence) applyRecencyNoticeEvidence(evidence, state);
  }
}
