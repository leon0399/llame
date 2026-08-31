export type DraftPhase = "fresh" | "sent";

export function draftPhaseFromSearchParam(
  value: string | Array<string> | undefined,
): DraftPhase | null {
  if (value === "fresh" || value === "sent") {
    return value;
  }

  return null;
}

export function draftChatPath(
  chatId: string,
  phase: DraftPhase | null,
): `/chat/${string}` {
  const searchParams = new URLSearchParams();

  if (phase !== null) {
    searchParams.set("draft", phase);
  }

  const query = searchParams.toString();
  return `/chat/${chatId}${query === "" ? "" : `?${query}`}`;
}

export function draftChatPathWithHash(
  chatId: string,
  phase: DraftPhase | null,
  hash: string,
): `/chat/${string}` {
  return `${draftChatPath(chatId, phase)}${hash}`;
}
