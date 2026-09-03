// Owned preview. The generated wrapper imports message.stories.tsx, which
// imports MessageResponse — Streamdown's markdown renderer, and with it Shiki's
// language grammars, mermaid and katex. That made _preview/Message.js 19.3 MB
// against the upload's 12 MB cap, so this file mirrors the stories' JSX while
// importing only what the shipped bundle actually contains.
//
// MessageResponse is NOT in the bundle (same size reason), so plain children
// stand in for it. For these stories that is nearly lossless: each one passes
// MessageResponse a single plain sentence, which it renders as one paragraph.
// The two stories that genuinely exercise markdown/LaTeX — Markdown and
// MathDelimiters — cannot be reproduced without the renderer and are skipped
// via cfg.overrides.Message.skip.
import * as React from "react";
import { CopyIcon, RefreshCcwIcon } from "lucide-react";

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@workspace/ui/components/ai-elements/message";

const noop = () => {};

export const Assistant = () => (
  <Message from="assistant">
    <MessageContent>
      Sure — here&apos;s a quick summary of what changed in this run.
    </MessageContent>
  </Message>
);

export const User = () => (
  <Message from="user">
    <MessageContent>Can you summarize what changed in this PR?</MessageContent>
  </Message>
);

// WithActions' story clicks Copy last in `play`, which leaves it focused for
// the reference screenshot. Compiled previews never run play(), so
// `autoFocus` seeds that same post-play end state.
export const WithActions = () => (
  <Message from="assistant">
    <MessageContent>Here&apos;s the summary you asked for.</MessageContent>
    <MessageActions>
      <MessageAction label="Retry" onClick={noop}>
        <RefreshCcwIcon className="size-3" />
      </MessageAction>
      <MessageAction autoFocus label="Copy" onClick={noop}>
        <CopyIcon className="size-3" />
      </MessageAction>
    </MessageActions>
  </Message>
);

// ActionWithTooltip's story likewise ends with the button focused, but this
// action also opens a Base UI Tooltip on focus. `autoFocus` here does seed
// the button's focus ring correctly, but the tooltip it also opens is
// portalled to <body> and lands OUTSIDE the reference screenshot's tight
// crop around the story root — so the sb reference never shows it, while an
// autoFocus'd preview (captured at full canvas size, uncropped) would. That
// trade (an unwanted tooltip bubble) is a bigger visual delta than the
// missing ring, so this story intentionally does NOT seed autoFocus.
export const ActionWithTooltip = () => (
  <Message from="assistant">
    <MessageContent>Here&apos;s the summary you asked for.</MessageContent>
    <MessageActions>
      <MessageAction label="Copy message" onClick={noop} tooltip="Copy">
        <CopyIcon />
      </MessageAction>
    </MessageActions>
  </Message>
);
