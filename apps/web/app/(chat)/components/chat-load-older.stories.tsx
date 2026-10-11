import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Conversation,
  ConversationContent,
} from "@workspace/ui/components/ai-elements/conversation";
import { expect, fireEvent, fn, waitFor, within } from "storybook/test";

import { ChatLoadOlder } from "./chat-load-older";

const MESSAGE_TEXT = "Here is the snippet you asked for.";
const CODE_TEXT = "const answer = 42;";
const OUTSIDE_TEXT = "Notes beside the chat";

/** The transcript's scroller, the content it scrolls, and the code block. */
function transcript(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  // SAFETY: Conversation renders its scroller as the log's only child.
  const scroller = canvas.getByRole("log").firstElementChild as HTMLElement;
  // SAFETY: the scroller holds the content it scrolls as its only child.
  const content = scroller.firstElementChild as HTMLElement;
  return { scroller, content, code: canvas.getByText(CODE_TEXT) };
}

/** How far the scroller's top edge sits above its farthest reachable point. */
function distanceFromBottom(scroller: HTMLElement) {
  return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
}

/** Waits until the transcript has landed on its newest line. */
async function landedAtBottom(scroller: HTMLElement) {
  await waitFor(() => expect(distanceFromBottom(scroller)).toBeLessThan(2));
}

/**
 * Grows the code block, as a late syntax highlight does, and resolves with the
 * scroll position in the frame that first shows the growth.
 *
 * The position is read from a ResizeObserver created after the transcript's
 * own, so its callback runs after theirs in that same frame: before the
 * browser paints it, and before the stick-to-bottom library's
 * requestAnimationFrame-deferred catch-up runs in the next frame.
 */
function growCodeAndMeasure(
  content: HTMLElement,
  code: HTMLElement,
  scroller: HTMLElement,
) {
  return new Promise<{ scrollTop: number; distance: number }>((resolve) => {
    const observer = new ResizeObserver(() => {
      observer.disconnect();
      resolve({
        scrollTop: scroller.scrollTop,
        distance: distanceFromBottom(scroller),
      });
    });
    observer.observe(content);
    code.style.height = "700px";
  });
}

/** Selects from `anchorNode` at `anchorOffset` to `focusNode` at `focusOffset`. */
function select(
  anchorNode: Node,
  anchorOffset: number,
  focusNode: Node,
  focusOffset: number,
) {
  const selection = document.getSelection();
  if (!selection) throw new Error("the page has no selection");
  selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
  return selection;
}

/** The text node `element` renders its text in. */
function textOf(element: HTMLElement) {
  const text = element.firstChild;
  if (!(text instanceof Text)) throw new Error("expected a text node");
  return text;
}

const meta = {
  component: ChatLoadOlder,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  // The whole history is loaded, so the sentinel itself renders nothing: what
  // these stories show is the scroll position it keeps while the transcript's
  // content grows.
  args: {
    hasOlder: false,
    isLoading: false,
    onLoadOlder: fn(),
    oldestMessageKey: "m-1",
  },
  beforeEach: () => () => {
    document.getSelection()?.removeAllRanges();
  },
  // A transcript as the chat page builds one: a bounded log that lands on the
  // newest message instantly, its one message tall enough to scroll, and a
  // note outside the log a selection can start from.
  render: (args) => (
    <div className="flex flex-col gap-4">
      <div className="flex h-72 flex-col">
        <Conversation initial="instant" resize="instant">
          <ConversationContent>
            <ChatLoadOlder {...args} />
            <div data-message-key="m-1" className="flex flex-col gap-2">
              <p>{MESSAGE_TEXT}</p>
              <pre className="h-100 rounded-md bg-muted p-2">{CODE_TEXT}</pre>
              {/* A real message carries its actions; one is also what lets a
                  keyboard reach the scrolling log. */}
              <button type="button" className="self-start text-sm">
                Copy
              </button>
            </div>
          </ConversationContent>
        </Conversation>
      </div>
      <p>{OUTSIDE_TEXT}</p>
    </div>
  ),
} satisfies Meta<typeof ChatLoadOlder>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A reader at the newest message stays there when the message grows: the
 * very frame that first shows the taller code block already shows its end.
 *
 * @summary stuck to the bottom: content growth never paints off-bottom
 */
export const StaysPinnedAsContentGrows: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const { scroller, content, code } = transcript(canvasElement);
    await landedAtBottom(scroller);
    const restingTop = scroller.scrollTop;

    const frame = await growCodeAndMeasure(content, code, scroller);

    await expect(frame.scrollTop).toBeGreaterThan(restingTop);
    await expect(frame.distance).toBeLessThan(2);
  },
};

/**
 * A reader who scrolled up to read earlier text is left where they are when
 * the message grows below them.
 *
 * @summary scrolled away: content growth leaves the reader in place
 */
export const LeavesAReaderWhoScrolledAway: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const { scroller, content, code } = transcript(canvasElement);
    await landedAtBottom(scroller);

    // The reader wheels up and the transcript scrolls with them.
    fireEvent.wheel(scroller, { deltaY: -120 });
    scroller.scrollTop = 40;

    const frame = await growCodeAndMeasure(content, code, scroller);

    await expect(frame.scrollTop).toBe(40);
  },
};

/**
 * A reader selecting text in the message is not scrolled out from under the
 * selection when the message grows.
 *
 * @summary selecting transcript text: content growth does not yank the reader
 */
export const KeepsAReaderSelectingText: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const { scroller, content, code } = transcript(canvasElement);
    await landedAtBottom(scroller);
    const restingTop = scroller.scrollTop;
    const message = textOf(within(canvasElement).getByText(MESSAGE_TEXT));
    await expect(select(message, 0, message, 4).toString()).toBe("Here");

    const frame = await growCodeAndMeasure(content, code, scroller);

    await expect(frame.scrollTop).toBe(restingTop);
  },
};

/**
 * A selection dragged backwards from the note outside the transcript into the
 * message holds the reader in place too, though it starts outside the log.
 *
 * @summary a reverse selection into the transcript: no yank either
 */
export const KeepsAReverseSelectionFromOutside: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const { scroller, content, code } = transcript(canvasElement);
    await landedAtBottom(scroller);
    const restingTop = scroller.scrollTop;
    const outside = textOf(canvas.getByText(OUTSIDE_TEXT));
    const message = textOf(canvas.getByText(MESSAGE_TEXT));

    const selection = select(outside, OUTSIDE_TEXT.length, message, 2);
    // The selection starts outside the log and ends inside the message.
    await expect(selection.anchorNode).toBe(outside);
    await expect(content.contains(selection.focusNode)).toBe(true);

    const frame = await growCodeAndMeasure(content, code, scroller);

    await expect(frame.scrollTop).toBe(restingTop);
  },
};
