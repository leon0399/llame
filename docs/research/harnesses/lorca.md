---
type: Reference
title: "Lorca"
description: "GPL-3.0-only Rust CLI that owns the agent loop, with desktop runners executing bots, phones that only pair, and a relay that stores ciphertext blobs."
resource: "https://github.com/egoist/lorca/tree/bf1ab709bc8df470016522578d7ae2df7740cd22"
tags: [harness, cli, pairing, relay, mobile, multi-host]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "bf1ab709bc8df470016522578d7ae2df7740cd22"
sources:
  - id: lorca-license
    resource: "https://github.com/egoist/lorca/blob/bf1ab709bc8df470016522578d7ae2df7740cd22/LICENSE#L1-L4"
    title: "GNU GPL version 3 heading"
  - id: lorca-readme
    resource: "https://github.com/egoist/lorca/blob/bf1ab709bc8df470016522578d7ae2df7740cd22/README.md#L3-L9"
    title: "CLI is the loop; desktop runners execute; phones are devices"
  - id: lorca-opaque
    resource: "https://github.com/egoist/lorca/blob/bf1ab709bc8df470016522578d7ae2df7740cd22/README.md#L16"
    title: "The relay receives signed requests and opaque blobs"
  - id: lorca-ws
    resource: "https://github.com/egoist/lorca/blob/bf1ab709bc8df470016522578d7ae2df7740cd22/crates/cli/src/ws.rs#L1-L7"
    title: "The local websocket refuses a non-loopback Host and requires a bearer token"
  - id: lorca-blob
    resource: "https://github.com/egoist/lorca/blob/bf1ab709bc8df470016522578d7ae2df7740cd22/crates/relay/src/db/postgres.rs#L50-L62"
    title: "Relay blobs store kind, seq, size, group id, and ciphertext"
---

# Lorca

- **Stack:** Rust CLI and relay, Go desktop UI, Expo phone app. GPL-3.0-only.[^lorca-license] The [tierroom board](https://my-tierroom.party/agents/lorca) and [lorca.app](https://lorca.app/) are live pages and are not pinned.

Lorca's README says the CLI is a localhost websocket service and the agent loop, and the desktop app is a UI for that CLI. Desktop devices are runners: a bot is created for a paired runner and uses that runner's credentials. Phones and tablets are devices, not runners.[^lorca-readme] Source inspection of the CLI websocket and the relay schema; the agent loop and memory files were not re-read, and nothing was run.

**Study**

1. **The terminal process is the executor.** The local websocket speaks JSON `{ id, method, params }` and pushes `{ event, data }`. Every route refuses a request with an `Origin` or a `Host` other than loopback on this port. `/ws` accepts only `Authorization: Bearer` of the token in `serve-token` in the data directory.[^lorca-ws] The desktop is a client of that process. A phone does not become a second loop. llame's [CLI grant is placement provenance for one directory](../../../ROADMAP.md#backlog-standalone-personal-node-and-cli), and it is backlog. Lorca's CLI is the loop for every paired UI.
2. **Runners are the machines that execute.** The README allows a bot on any paired runner.[^lorca-readme] Several desktops are several executors under one account. A phone reaches a runner; it does not run the bot. That is [execution follows the machine that can do the work](../../../VISION.md#execution-follows-intent-and-capability), with the account's encrypted provider credentials delivered to that runner, as the README states.
3. **The relay stores ciphertext and also the envelope.** Postgres `blobs` has `kind`, `recipient_machine_pubkey`, `seq`, `ciphertext`, `size`, and `group_id`.[^lorca-blob] The README says traffic to the network is end-to-end encrypted.[^lorca-readme] The stack list says the relay receives signed requests and opaque blobs.[^lorca-opaque] The payload column is ciphertext. Kind, sequence, size, group id, and public keys are plaintext columns. The board says shell tools run as the OS user. That matches a runner with no sandbox in the files read here; the security doc on the website was not pinned.

**llame fit**

- High: item 1's loopback-and-token gate for a local CLI that other UI processes attach to. A TUI or desktop that is only a client matches the direction of a host-owned run.
- Moderate: item 2, for more than one executor machine, with the phone kept off the executor set.
- Moderate: item 3's ciphertext blob store. Confirm control-plane metadata before copying the relay.
- Low: group orchestration and Markdown memory, which the board describes and this pass did not open.

**Caution:** GPL-3.0-only. Approved shell commands, if they run as the runner user, are host authority. The README's encryption claim and the blob column agree on stored payload opacity; provider requests leave the runner under the provider's terms, which the board also says.

[^lorca-license]: [GNU GPL version 3 heading](https://github.com/egoist/lorca/blob/bf1ab709bc8df470016522578d7ae2df7740cd22/LICENSE#L1-L4)

[^lorca-readme]: [CLI is the loop; desktop runners execute; phones are devices](https://github.com/egoist/lorca/blob/bf1ab709bc8df470016522578d7ae2df7740cd22/README.md#L3-L9)

[^lorca-opaque]: [The relay receives signed requests and opaque blobs](https://github.com/egoist/lorca/blob/bf1ab709bc8df470016522578d7ae2df7740cd22/README.md#L16)

[^lorca-ws]: [The local websocket refuses a non-loopback Host and requires a bearer token](https://github.com/egoist/lorca/blob/bf1ab709bc8df470016522578d7ae2df7740cd22/crates/cli/src/ws.rs#L1-L7)

[^lorca-blob]: [Relay blobs store kind, seq, size, group id, and ciphertext](https://github.com/egoist/lorca/blob/bf1ab709bc8df470016522578d7ae2df7740cd22/crates/relay/src/db/postgres.rs#L50-L62)
