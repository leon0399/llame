/** Builds the stored tool part of one settled call (design D5). */
import { isRecord, isString } from '@workspace/runtime-safety';
import { type ProviderMetadata } from 'ai';
import {
  isHopRejection,
  normalizeToolObservationOutcome,
} from '../chats/tool-observation-part';
import { type RetainedMediaJson } from '../media/retained-media';
import { type SdkRefusal } from '../models/model-client';
import { isArtifactLocator } from '../tools/artifacts/locator';
import { type PermissionDecision } from '../tools/permissions/types';
import { type ToolClassification, type ToolResult } from '../tools/types';
import { type DerivedDecisionRecord } from '../tools/web-read/admission';
import { type ToolActivityPart } from './assistant-transcript';

export type ToolActivityPartInput = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly intent?: string;
  readonly result: ToolResult;
  /** The model step that produced this call (design D5). */
  readonly step?: number;
  /**
   * The SDK's own error text and input form for a call it refused (design D3,
   * proposal A8), copied from the refusal seam.
   */
  readonly sdkRefusal?: SdkRefusal;
  /**
   * The call's opaque provider metadata (design A7), stored once on the call:
   * the consumer delivered it before the call executed, and every settlement
   * path carries it here from the event's open call entry.
   */
  readonly providerMetadata?: ProviderMetadata;
  readonly permission?: PermissionDecision;
  readonly derivedDecisions?: ReadonlyArray<DerivedDecisionRecord>;
  /**
   * The executing tool's classification, `null` when the call never started,
   * and absent when the event that started it recorded none.
   */
  readonly classification?: ToolClassification | null;
  /**
   * The retained bytes the call's read keeps, or the record that its message
   * bound is exceeded. Absent for every result that keeps none: a stored
   * `media://` result, a refused read, and a system-origin read such as a
   * prompt import, whose bytes live in the import's own entry.
   */
  readonly retainedMedia?: RetainedMediaJson;
  /** An owner interrupt settled the call (run-steering D7). */
  readonly interrupted?: boolean;
};

/**
 * The one stored tool part for a settled call, shared by the live path, the
 * durable reconstructor, and wake projection so each stores the same shape.
 */
export function toolActivityPart(
  call: ToolActivityPartInput,
): ToolActivityPart {
  const part = toolPartBody(call);

  if (call.intent !== undefined) {
    part.intent = call.intent;

    // The model sees each earlier call as it sent it, `i` included.
    if (isRecord(part.input)) part.input = { i: call.intent, ...part.input };
  }

  if (call.step !== undefined) part.step = call.step;

  if (call.sdkRefusal !== undefined) part.sdkRefusal = call.sdkRefusal;

  if (call.retainedMedia !== undefined) part.retainedMedia = call.retainedMedia;

  if (call.providerMetadata !== undefined)
    part.providerMetadata = call.providerMetadata;

  if (call.permission !== undefined) part.permission = call.permission;

  if (call.derivedDecisions !== undefined && call.derivedDecisions.length > 0) {
    part.derivedDecisions = call.derivedDecisions;
  }

  // Only the native `read` tool's refused hop names a redirect target, and an
  // absent value must add no property at all.
  const refusedUrl =
    call.result.status === 'error' &&
    isHopRejection(call.toolName, call.result.type)
      ? call.result.rejectedUrl
      : undefined;

  if (refusedUrl !== undefined) part.errorRejectedUrl = refusedUrl;
  const artifact = isRecord(call.result) ? call.result['artifact'] : undefined;

  if (isString(artifact) && isArtifactLocator(artifact))
    part.artifact = artifact;

  return part;
}

/** The settled state a call's result stores, before its decision metadata. */
function toolPartBody(call: ToolActivityPartInput): ToolActivityPart {
  const { toolCallId, toolName, input, result, classification } = call;
  // Absent means the call started before the event recorded a classification;
  // `null` means it never started at all.
  const known = classification === undefined ? {} : { classification };
  // A cancelled result and a result an owner interrupt settled each carry
  // their own marker; an interrupted `cancelled` result carries both.
  const cancelled = result.status === 'error' && result.type === 'cancelled';
  const interrupted = call.interrupted === true;

  const marked =
    cancelled || interrupted
      ? {
          resultProviderMetadata: {
            llame: {
              ...(cancelled && { cancelled: true as const }),
              ...(interrupted && { interrupted: true as const }),
            },
          },
        }
      : {};

  return result.status === 'success'
    ? {
        type: `tool-${toolName}`,
        toolCallId,
        state: 'output-available',
        input,
        output: result,
        outcome: 'success',
        ...known,
        ...marked,
      }
    : {
        type: `tool-${toolName}`,
        toolCallId,
        state: 'output-error',
        input,
        errorText: result.message,
        outcome: normalizeToolObservationOutcome(result.type, 'error'),
        ...known,
        ...marked,
      };
}
