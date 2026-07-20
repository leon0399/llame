# Configuration

The addon is a Storybook-first development tool. Capture, review, and approval
start inside Storybook; the package does not require a separate local CLI
workflow.

## Add the preset

Add the preset to the consuming Storybook's `main.ts`. `storyRoots` are resolved
from the Storybook process working directory and must contain every story source
that may receive source-adjacent artifacts.

```ts
const config = {
  addons: [
    {
      name: "@workspace/storybook-addon-visual-tests/preset",
      options: {
        storyRoots: ["../../packages/ui/src"],
      },
    },
  ],
};
```

The preset installs the manager UI, preview readiness annotation, development
server channel, and artifact route. Static Storybook keeps the panel visible but
cannot capture or approve repository files.

## Run and review

The Visual tests panel is scoped to the selected story. Both run controls in
that panel capture only that story, so a small component does not wait behind the
entire catalog. Storybook's testing widget owns the explicit run-all action.

Results remain reviewable one story at a time. Accept promotes the exact
candidate already displayed in the panel; it does not recapture.

## Story parameters

Parameters follow normal Storybook inheritance: project parameters are the
default, component metadata overrides them, and an individual story is most
specific.

### Disable visual tests

Disable every story in a component file from its metadata:

```ts
const meta = {
  component: Button,
  parameters: {
    visualTests: {
      disable: true,
    },
  },
} satisfies Meta<typeof Button>;
```

Or disable one story:

```ts
export const Animated: Story = {
  parameters: {
    visualTests: {
      disable: true,
    },
  },
};
```

Disabled stories report a passing result with an explanatory message and do not
write a candidate.

### Choose screenshot framing

The default is `content`, except when the resolved Storybook
`parameters.layout` is `fullscreen`; fullscreen stories default to `viewport`.
Override either behavior at project, component, or story level:

```ts
const meta = {
  component: CanvasEditor,
  parameters: {
    visualTests: {
      capture: "viewport",
    },
  },
} satisfies Meta<typeof CanvasEditor>;
```

```ts
export const CompactFullscreenShell: Story = {
  parameters: {
    layout: "fullscreen",
    visualTests: {
      capture: "content",
    },
  },
};
```

Supported values:

- `content`: crop to visible story content and body portals within the viewport.
- `viewport`: capture the complete fixed browser viewport.

Changing framing changes baseline semantics and normally requires reviewing and
approving a new baseline.

## Repository ignores

Commit `baseline.png` and `baseline.json`. Ignore transient run artifacts:

```gitignore
**/__screenshots__/**/candidate.png
**/__screenshots__/**/diff.png
**/__screenshots__/**/result.json
**/__screenshots__/**/*.tmp
```

The consuming repository owns these patterns because screenshots live beside
consumer stories, outside the addon package.
