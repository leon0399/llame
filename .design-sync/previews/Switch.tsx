import * as React from "react";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Switch } from "@workspace/ui/components/switch";
import * as S from "@ds-stories/packages/ui/src/components/switch.stories";

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

// Description and With Aria Label each have a play function that clicks the
// switch on with no untoggle afterward (the interaction-driven-content
// limitation documented in .ds-sync/storybook/SKILL.md §4a — compiled
// previews never run play). The storybook reference screenshot is captured
// POST-play, so both stories below mirror the story's JSX verbatim but with
// `defaultChecked` set on the Switch (its post-play end state) instead of the
// story's own pristine unchecked initial state. The meta decorator
// (`w-[24rem] max-w-full`) is applied by hand since this bypasses the
// generated compose()/decorator plumbing; every other story is unaffected by
// play and stays composed unchanged from the story module.
const frame = "w-[24rem] max-w-full";

export const Basic = /* Basic */ compose(S, "Basic");

export const Description = () => (
  <div className={frame}>
    {/* play clicks the switch on, never toggles it back off */}
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="switch-focus-mode">
          Share across devices
        </FieldLabel>
        <FieldDescription>
          Focus is shared across devices, and turns off when you leave the app.
        </FieldDescription>
      </FieldContent>
      <Switch id="switch-focus-mode" defaultChecked />
    </Field>
  </div>
);

export const ChoiceCard = /* Choice Card */ compose(S, "ChoiceCard");
export const Disabled = /* Disabled */ compose(S, "Disabled");
export const Invalid = /* Invalid */ compose(S, "Invalid");

export const WithAriaLabel = () => (
  <div className={frame}>
    {/* play clicks the switch on, never toggles it back off */}
    <Switch aria-label="Bare switch" defaultChecked />
  </div>
);

export const DefaultChecked = /* Default Checked */ compose(
  S,
  "DefaultChecked",
);
export const DisabledChecked = /* Disabled Checked */ compose(
  S,
  "DisabledChecked",
);
export const Sizes = /* Sizes */ compose(S, "Sizes");
