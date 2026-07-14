// Mirrors apps/api/src/pins/dto/pins.dto.ts's PinnedItemResponse (a discriminated
// oneOf: itemType selects the card shape). Kept as a plain type here (no codegen
// yet — SPEC §22.0), same convention as ../project/types.ts. `item` is a LEAN
// per-type reference card — presentation-stable fields only (title/name),
// never the volatile lastMessage/status that stream — so the pins cache's
// staleness surface stays bounded to explicit edits (design D2/D5).
// `archivedAt` (chat-project-archive) lets the rail render an "Archived"
// indicator without a second fetch.
export type ChatRefCard = {
  id: string;
  // null = untitled chat (#78); render the localized placeholder.
  title: string | null;
  // Archive state; null = not archived.
  archivedAt: string | null;
};

export type ProjectRefCard = {
  id: string;
  name: string;
  // Archive state; null = not archived.
  archivedAt: string | null;
};

export type PinnedItem =
  | {
      itemType: "chat";
      itemId: string;
      pinnedAt: string;
      item: ChatRefCard;
    }
  | {
      itemType: "project";
      itemId: string;
      pinnedAt: string;
      item: ProjectRefCard;
    };

export type PinItemType = PinnedItem["itemType"];
