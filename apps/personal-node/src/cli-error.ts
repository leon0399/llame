import { PeerSyncOutcomeUnknownError } from "./sync-client.js";

export type PersonalNodeCliError =
  | {
      readonly error: "outcome_unknown";
      readonly operation: "peer_sync_apply";
      readonly rounds: number;
      readonly localFrontier: Readonly<Record<string, number>>;
    }
  | {
      readonly error: "failure";
      readonly message: string;
    };

export function describeCliError(error: unknown): PersonalNodeCliError {
  if (error instanceof PeerSyncOutcomeUnknownError) {
    return {
      error: "outcome_unknown",
      operation: "peer_sync_apply",
      rounds: error.rounds,
      localFrontier: error.localFrontier,
    };
  }
  return {
    error: "failure",
    message: error instanceof Error ? error.message : "unknown error",
  };
}
