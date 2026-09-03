import * as React from "react";
import * as S from "@ds-stories/packages/ui/src/components/custom/model-switch-boundary.stories";

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

export const Collapsed = /* Collapsed */ compose(S, "Collapsed");
export const LongModelIds = /* Long Model Ids */ compose(S, "LongModelIds");

// The story's play() presses Enter on the trigger to expand the disclosure
// before the reference screenshot is taken; compiled previews never run
// play(), so this preview instead clicks the trigger on mount to reach the
// same open end-state (the component's `open` boolean is internal
// useState, not a controllable prop).
const KeyboardDisclosureBase = /* Keyboard Disclosure */ compose(
  S,
  "KeyboardDisclosure",
);

export const KeyboardDisclosure = () => {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
      ?.click();
  }, []);

  return React.createElement(
    "div",
    { ref },
    React.createElement(KeyboardDisclosureBase),
  );
};
