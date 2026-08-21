import type {
  ChatPinnedItemResponse,
  ChatRefCard as GeneratedChatRefCard,
  ProjectPinnedItemResponse,
  ProjectRefCard as GeneratedProjectRefCard,
} from "../../api/generated/models";

/** Feature-facing aliases keep generated models out of component imports. */
export type ChatRefCard = GeneratedChatRefCard;
export type ProjectRefCard = GeneratedProjectRefCard;
export type PinnedItem = ChatPinnedItemResponse | ProjectPinnedItemResponse;

export type PinItemType = PinnedItem["itemType"];
