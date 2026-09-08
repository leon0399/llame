# .github/workflows

Flag unpinned action references (this repo pins by SHA via pinact), `pull_request_target`
combined with a checkout of untrusted code, secrets reachable from a fork-triggered job,
and script injection through `${{ github.event.* }}` interpolated into a `run` block.
