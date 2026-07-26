# Configuration

The addon is a Storybook-first development tool. Capture, review, and approval
start inside Storybook; the package does not require a separate local CLI
workflow.

Before configuring it, read the preview support target and the trust boundary in
the [README](../README.md): the supported combinations are release targets, not
verified support, and anyone who can reach the development manager channel can
approve baselines into your repository.

## Add the preset

Add the preset to the consuming Storybook's `main.ts`. `storyRoots` are resolved
from the Storybook process working directory and must contain every story source
that may receive source-adjacent artifacts.

```ts
const config = {
  addons: [
    {
      name: "storyproof/preset",
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

## Preset options

Both options are optional. Storybook passes addon options through without
validating them, so the preset validates them itself when the development
server starts.

| Option           | Type       | Default | Constraint                                        |
| ---------------- | ---------- | ------- | ------------------------------------------------- |
| `storyRoots`     | `string[]` | `["."]` | Non-empty array of non-empty strings              |
| `maxConcurrency` | `number`   | `2`     | Integer greater than `0`; there is no upper bound |

`storyRoots` entries resolve from the Storybook process working directory. A
story that resolves outside every root is refused rather than given artifacts
outside the configured tree.

`maxConcurrency` bounds how many stories are captured at once. The default of
`2` is deliberate and conservative; no evidence yet supports a specific maximum,
so none is enforced.

### Validation and errors

Validation runs **before** the capture runner is constructed, so an invalid
value fails Storybook's development server at startup rather than surfacing
midway through a capture run. Every error names the offending option, the value
received, and the default. Each message below is thrown as a single line and is
only wrapped here for page width:

```text
[storyproof] Invalid "maxConcurrency" preset option: expected
an integer greater than 0, received NaN. Omit it to use the default 2.
```

```text
[storyproof] Invalid "storyRoots[1]" preset option: expected a
non-empty string, received "". Set "storyRoots" to a non-empty array of
non-empty strings, or omit it to use the default ["."].
```

Rejected because `main.ts` is JavaScript at runtime and TypeScript types alone
do not stop these:

- `storyRoots`: a bare string, an object, `null`, an empty array, an empty or
  whitespace-only member, any array mixing strings with non-strings, and a
  sparse array — an unfilled slot in `new Array(3)` is rejected the same way an
  explicit `undefined` is.
- `maxConcurrency`: a string, `null`, a boolean, an object — including a boxed
  `new Number(2)` — a bigint, `0`, a negative number, a fractional number,
  `NaN`, and either infinity.

Omitting an option is the only way to get its default; passing `null` or `0` is
an error rather than a silent fallback.

Validation is deliberately scoped to the development server. A static Storybook
build never captures, so these options are inert there and an invalid value does
not fail `storybook build` — it fails the next `storybook dev`.

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
**/__screenshots__/**/*.tmp
```

The consuming repository owns these patterns because screenshots live beside
consumer stories, outside the addon package.
