import type { DraftPhase } from "./draft-route";

export type DraftSessionState =
  | { kind: "fresh" }
  | { kind: "sending" }
  | { kind: "recovering"; ownerMounted: boolean }
  | { kind: "persisted"; resumeRequested: boolean };

export type DraftSessionEvent =
  | { type: "send-started" }
  | { type: "send-failed" }
  | { type: "chat-visible" }
  | { type: "history-missing" }
  | { type: "history-indeterminate" }
  | { type: "finished" };

export function initialDraftSession(
  phase: DraftPhase | null,
  chatExists: boolean,
): DraftSessionState {
  if (chatExists) {
    return { kind: "persisted", resumeRequested: true };
  }

  if (phase === "sent") {
    return { kind: "recovering", ownerMounted: false };
  }

  return { kind: "fresh" };
}

export function reduceDraftSession(
  state: DraftSessionState,
  event: DraftSessionEvent,
): DraftSessionState {
  switch (event.type) {
    case "send-started":
      return state.kind === "fresh" ? { kind: "sending" } : state;
    case "send-failed":
      return state.kind === "sending"
        ? { kind: "recovering", ownerMounted: true }
        : state;
    case "chat-visible":
      return state.kind === "recovering"
        ? { kind: "persisted", resumeRequested: true }
        : state;
    case "history-missing":
      return state.kind === "recovering" ? { kind: "fresh" } : state;
    case "history-indeterminate":
      return state;
    case "finished":
      return { kind: "persisted", resumeRequested: false };
  }
}

export function draftPhaseForSession(
  state: DraftSessionState,
): DraftPhase | null {
  switch (state.kind) {
    case "fresh":
      return "fresh";
    case "sending":
    case "recovering":
      return "sent";
    case "persisted":
      return null;
  }
}

export function shouldQueryChatHistory(state: DraftSessionState): boolean {
  return state.kind === "recovering" || state.kind === "persisted";
}

export function shouldRenderChatOwner(state: DraftSessionState): boolean {
  return state.kind !== "recovering" || state.ownerMounted;
}

export function shouldResumeChat(state: DraftSessionState): boolean {
  return state.kind === "persisted" && state.resumeRequested;
}
