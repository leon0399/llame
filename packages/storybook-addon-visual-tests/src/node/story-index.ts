import type { StoryIndex, StoryIndexEntry } from "storybook/internal/types";

export interface StoryIndexGenerator {
  getIndex(): StoryIndex | Promise<StoryIndex>;
}

export interface StorySelection {
  scope: "all" | "current";
  storyId?: string;
}

export async function discoverStories(
  generator: StoryIndexGenerator,
  selection: StorySelection,
): Promise<StoryIndexEntry[]> {
  const index = await generator.getIndex();
  const stories = Object.values(index.entries).filter(
    (entry): entry is StoryIndexEntry => entry.type === "story",
  );
  if (selection.scope === "all") return stories;

  const story = stories.find((entry) => entry.id === selection.storyId);
  if (!story) {
    throw new Error(`Unknown Storybook story ID: ${selection.storyId ?? ""}`);
  }
  return [story];
}
