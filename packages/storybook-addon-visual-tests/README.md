# `@workspace/storybook-addon-visual-tests`

Repo-local, Chromium-first visual testing for Storybook. The primary workflow
lives inside Storybook: run the full visual suite from the testing widget or the
selected story from its panel, inspect its baseline/candidate/diff images, and
approve the exact captured candidate.

- [Configuration](docs/configuration.md)
- [Capture contract](docs/capture-contract.md)
- [Roadmap](ROADMAP.md)

## Preview support target

The first public preview is a narrow tool, not a general visual-testing
platform. The table below is the **target** the release must prove. Nothing in
it is verified support yet: every row stays a target until the packed-consumer
CI matrix in the
[release plan](docs/2026-07-24-public-preview-release-plan.md) passes against
the packed release artifact. "Exercised" means the combination runs today inside this
repository — it is local evidence, not a support claim.

| Dimension             | Preview target (not yet verified)                  | Evidence today (not a support claim)                        |
| --------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| Node.js               | `>=22.12 <23`                                      | Exercised on 22.x (repository `.node-version` is `22.12.0`) |
| Storybook             | `>=10.5.0 <10.6.0`                                 | Exercised on 10.5.0                                         |
| React                 | `^19.0.0`                                          | Exercised on 19.2.7                                         |
| Framework integration | `@storybook/react-vite`                            | Exercised on `@storybook/react-vite` 10.5.0                 |
| Browser               | bundled Playwright Chromium (`playwright` 1.55.1)  | Exercised                                                   |
| Operating system      | Ubuntu 24.04 x64                                   | Exercised on GitHub-hosted Ubuntu x64                       |
| Storybook mode        | local development server                           | Exercised; static builds report visual testing unavailable  |
| Capture topology      | direct loopback HTTP in the same network namespace | Exercised                                                   |

Peer and engine ranges in `package.json` are provisional. The current Node
engine is only a minimum-install floor, not a support claim. These ranges are
finalized — and the wording here changes from target to verified — only after
the release CI matrix supplies evidence.

### Additional operating systems require baseline portability

The initial preview claims Ubuntu 24.04 x64 only. Adding another operating
system or Linux distribution requires two separate proofs:

1. **Startup** — the addon launches, captures, and compares on an operating
   system.
2. **Baseline portability** — exact baseline files approved on Ubuntu 24.04
   pass the fixed comparator on the new host without reapproval.

The environment key `chromium-1280x720@1x` deliberately omits the platform, and
baseline compatibility ignores the recorded `platform` field, so portability is
_assumed by the current design and unproven_. It is not an Ubuntu-only preview
release gate. Before claiming another host platform, transfer the exact approved
baseline files to it and rerun without approval. Candidate bytes need not be
identical if the fixed comparator passes. Per-platform environment identities
change baseline paths and review semantics and need their own design.

### Not in the preview

Two different kinds of exclusion, and the difference matters — one is a
statement about the implementation, the other only about scope:

- **Out of reach today.** HTTPS capture origins, reverse-proxy path prefixes,
  and capture split across containers or hosts. These are not merely untested:
  the capture origin is not configurable, so the implementation cannot reach a
  Storybook it does not share a loopback interface with. The
  [capture contract](docs/capture-contract.md) holds the itemized list and the
  reason for each.
- **Deliberately deferred, not precluded.** Remote approval, browsers other than
  Chromium, viewport matrices, theme matrices, masking, and a CI runner. Each is
  an ordinary scope decision tracked in the [roadmap](ROADMAP.md), and each
  needs its own design because it expands baseline identity, review semantics,
  or execution topology.

## Trust boundary

Development Storybook is a **trusted local interface**, and the addon relies on
that assumption instead of adding its own authentication:

- Any party that can reach the development manager channel can request runs and
  approvals. The addon does not authenticate the party issuing a command.
- Approval **writes files into your repository** — the baseline PNG and its
  metadata, beside the story source.
- Candidate SHA-256 hashes bind an approval to the exact captured bytes. They
  establish **integrity, not human identity**, and reject stale approvals; they
  are not an authorization check.
- Authorization for a committed baseline change is **Git diff, commit review,
  and pull-request review** — the same review path as any other repository
  change.

Run the development server on loopback only, and treat exposing it on a shared
network as granting repository write access.

## Storage

Artifacts stay beside their story source:

```text
button.stories.tsx
__screenshots__/
  button.stories.tsx.visual/
    button--primary/
      chromium-1280x720@1x/
        baseline.png
        baseline.json
        candidate.png
        diff.png
```

Commit `baseline.png` and `baseline.json`. Candidate, diff, result, and atomic
temporary files are gitignored. The `.visual` suffix prevents Storybook's story
glob from mistaking an artifact directory for a story file.

## Capture contract

The initial environment is fixed: bundled Playwright Chromium, `1280x720`, DPR
1, `en-US`, UTC, and reduced motion. Capture waits for Storybook's finished
event, including the story `play` function. Normal component stories are
cropped to their visible content, including body portals. Fullscreen stories
retain the viewport. A story or component can override that choice or disable
visual capture through `parameters.visualTests`.

See the [capture contract](docs/capture-contract.md) for exact framing semantics
and [configuration](docs/configuration.md) for component and story examples.

The addon is development-only because approval writes repository files. Static
Storybook builds keep the panel visible but mark visual testing unavailable.

## Verification

```bash
pnpm --filter @workspace/storybook-addon-visual-tests test
pnpm --filter @workspace/storybook-addon-visual-tests typecheck
pnpm --filter @workspace/storybook-addon-visual-tests lint
pnpm test:visual
```

`pnpm test:visual` is the addon integration smoke test; normal visual test runs
start from the Storybook panel, not from a CLI runner.
