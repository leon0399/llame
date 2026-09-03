import * as React from "react";
import { BookmarkIcon } from "lucide-react";
import { Toggle } from "@workspace/ui/components/toggle";
import * as S from "@ds-stories/packages/ui/src/components/toggle.stories";

function compose(S: any, key: string) {
  const meta: any = S.default ?? {};
  const st: any = S[key];
  const args: any = { ...(meta.args ?? {}), ...(st && st.args ? st.args : {}) };
  // Storybook resolves argTypes.mapping (control value -> real arg) before
  // rendering; mirror that so mapped args don't render raw.
  const at: any = {
    ...(meta.argTypes ?? {}),
    ...(st && st.argTypes ? st.argTypes : {}),
  };
  for (const k of Object.keys(args)) {
    const m = at[k] && at[k].mapping;
    if (m && typeof m === "object" && args[k] in m) args[k] = m[args[k]];
  }
  const title: string = typeof meta.title === "string" ? meta.title : "";
  const ctx: any = {
    args,
    name: key,
    title,
    kind: title,
    id: "",
    componentId: "",
    globals: {},
    viewMode: "story",
    parameters: (st && st.parameters) ?? meta.parameters ?? {},
  };
  let render: (() => any) | null = null;
  if (st && typeof st.render === "function")
    render = () => st.render(args, ctx);
  else if (typeof st === "function") render = () => st(args, ctx);
  else if (typeof meta.render === "function")
    render = () => meta.render(args, ctx);
  else {
    const C = (st && st.component) || meta.component;
    if (C) render = () => React.createElement(C, args);
  }
  if (!render) return () => null;
  // [].concat: a single function is legal CSF decorator shorthand. A
  // decorator returning undefined (stubbed addon) falls through to the inner
  // render — otherwise one unrecognized addon blanks the cell silently.
  const decorators: any[] = ([] as any[])
    .concat((st && st.decorators) ?? [])
    .concat(meta.decorators ?? []);
  return decorators.reduce(
    (inner: any, dec: any) => () => {
      const out = dec(inner, ctx);
      return out === undefined ? inner() : out;
    },
    render,
  );
}

// Basic has a play function that clicks the toggle pressed with no untoggle
// afterward (the interaction-driven-content limitation documented in
// .ds-sync/storybook/SKILL.md §4a — compiled previews never run play). The
// storybook reference screenshot is captured POST-play, so it's mirrored
// below verbatim but with `defaultPressed` set (its post-play end state)
// instead of the story's own pristine unpressed initial state. Every other
// story is unaffected by play and stays composed unchanged from the story
// module.
export const Basic = () => (
  <Toggle
    aria-label="Toggle bookmark"
    size="sm"
    variant="outline"
    defaultPressed
  >
    <BookmarkIcon className="group-aria-pressed/toggle:fill-foreground" />
    Bookmark
  </Toggle>
);

export const Outline = /* Outline */ compose(S, "Outline");
export const WithText = /* With Text */ compose(S, "WithText");
export const Sizes = /* Sizes */ compose(S, "Sizes");
export const Disabled = /* Disabled */ compose(S, "Disabled");
