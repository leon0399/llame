---
type: Reference
title: "PiNomad"
description: "Self-hosted Pi Durable host: Mac, web, and iOS clients attach to one machine, and coding tools run there with no approval gate."
resource: "https://github.com/bubbleptr/pinomad"
tags: [harness, durable-execution, multi-client, pairing, permissions]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-10-30"
observed:
  date: "2026-10-30"
  revision: "ea50587ea0ad10b484b4a17c8e521b0706a3db42"
sources:
  - id: pinomad-license-l1-l4
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/LICENSE#L1-L4"
    title: "Apache License 2.0 heading"
  - id: pinomad-readme-license-l49
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/README.md#L49"
    title: "Apache-2.0, with Pi notices under docs/licenses"
  - id: pinomad-host-package-l11-l16
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/package.json#L11-L16"
    title: "Pi Durable and related packages pinned at 1.4.0"
  - id: pinomad-adr-0002-l7-l12
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/docs/adr/0002-pi-durable-as-runtime.md#L7-L12"
    title: "Durable storage is the runtime; several clients share one session"
  - id: pinomad-data-dir-l6-l7
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/cli/host-address.ts#L6-L7"
    title: "Default data directory is ~/.pinomad unless PINOMAD_DATA_DIR is set"
  - id: pinomad-host-open-l219-l223
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/host.ts#L219-L223"
    title: "One execution environment per cwd, and session.sqlite in the data dir"
  - id: pinomad-host-env-l247-l250
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/host.ts#L247-L250"
    title: "NodeExecutionEnv is constructed for that cwd"
  - id: pinomad-host-resume-l333-l334
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/host.ts#L333-L334"
    title: "Startup calls harness.resume"
  - id: pinomad-host-close-l372
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/host.ts#L372"
    title: "Close writes no tool outcome"
  - id: pinomad-adr-0009-l16
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/docs/adr/0009-host-lifecycle.md#L16"
    title: "bash, write, and edit are not replayed after an interrupt"
  - id: pinomad-coding-l26-l27
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/extensions/coding.ts#L26-L27"
    title: "read, write, edit, and bash run with no approval gate"
  - id: pinomad-adr-0011-l14-l16
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/docs/adr/0011-ask-user-question-replaces-approval.md#L14-L16"
    title: "ask_user_question replaces an approval gate"
  - id: pinomad-checkout-l194-l207
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/organization.ts#L194-L207"
    title: "A git project defaults to a worktree; a plain project sets cwd"
  - id: pinomad-chat-cwd-l247-l250
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/organization.ts#L247-L250"
    title: "A Chat cwd is a directory under the data dir"
  - id: pinomad-protocol-l88-l96
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/packages/protocol/src/frames.ts#L88-L96"
    title: "Protocol 5.25; a different major version cannot talk"
  - id: pinomad-relay-l1-l5
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/packages/protocol/src/relay.ts#L1-L5"
    title: "The relay forwards Noise ciphertext; control frames are plaintext"
  - id: pinomad-admit-l47-l54
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/devices.ts#L47-L54"
    title: "Device admission is one commit"
  - id: pinomad-credentials-l152-l157
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/main.ts#L152-L157"
    title: "auth.json and models.json live in the data directory"
  - id: pinomad-adr-0031-l20-l22
    resource: "https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/docs/adr/0031-host-owns-credentials-and-providers.md#L20-L22"
    title: "The host no longer reads Pi's credential files"
---

# PiNomad

- **Stack:** Node host (`apps/host`) on [@earendil-works/pi-durable](https://www.npmjs.com/package/@earendil-works/pi-durable) 1.4.0, with web, Electron, and iOS clients.[^pinomad-host-package-l11-l16] **License:** Apache-2.0. Code adapted from Pi is MIT and listed under `docs/licenses/`.[^pinomad-license-l1-l4][^pinomad-readme-license-l49] The site [pinomad.si](https://pinomad.si) is a live page and is not pinned.

PiNomad is a self-hosted coding product on the experimental Pi Durable runtime described in [Earendil Pi](./earendil-pi.md). The host opens a `Harness` on `session.sqlite` in its data directory. The default is `~/.pinomad` unless `PINOMAD_DATA_DIR` is set.[^pinomad-data-dir-l6-l7] Clients are gateway peers of that process.[^pinomad-adr-0002-l7-l12][^pinomad-host-open-l219-l223] Source inspection only; nothing was run. Pi Durable's own checkpoint format was not re-read in this tree.

**Study**

1. **One host, many windows.** ADR-0002 chooses Pi Durable because a crashed host should continue an unfinished model call or tool task from a checkpoint, and because several clients observe one session.[^pinomad-adr-0002-l7-l12] Startup calls `harness.resume()`. Close writes no tool outcome; the comment says a running turn resumes at the next open.[^pinomad-host-resume-l333-l334][^pinomad-host-close-l372] An interrupt is tool-specific: tools marked `replay: "safe"` run again; bash, write, and edit do not, and the model receives an interrupted result that may be partial.[^pinomad-adr-0009-l16] The README sentence that Pi Durable checkpoints every model call and tool call is stronger than that ADR. llame already treats a [Run as the unit of execution](../../../VISION.md#runs-are-the-unit-of-execution); a phone attached to a host is a client, not a second Run store.
2. **Tools run on the host, with no approval gate.** Coding tools are Durable's read, write, edit, and bash bundle, executed through a `NodeExecutionEnv` for the conversation cwd.[^pinomad-coding-l26-l27][^pinomad-host-env-l247-l250] ADR-0011 removes the approval gate and keeps `ask_user_question` for ambiguity. The tool blocks until the person answers.[^pinomad-adr-0011-l14-l16] A paired device has the same reach as a local client. That is the opposite of [the harness owns execution](../../../VISION.md#the-harness-owns-execution) for shell and file writes: the host executes, and it does not ask.
3. **The cwd is chosen when the conversation is created.** A project is a directory the person registers. A git project defaults to a worktree unless `checkout` is `project`. A non-worktree project sets `agent.cwd` to that path in the creation call. A Chat home's cwd is `<dataDir>/chats/<id>`, set in the same commit.[^pinomad-checkout-l194-l207][^pinomad-chat-cwd-l247-l250][^pinomad-host-open-l219-l223] The environment map is one `NodeExecutionEnv` per cwd.[^pinomad-host-env-l247-l250]
4. **Pairing is the authorization boundary.** Protocol major 5, minor 25: a different major version cannot talk.[^pinomad-protocol-l88-l96] After the relay handshake, forwarded bytes are already Noise-encrypted. The relay's own control frames are plaintext, so it sees connection metadata.[^pinomad-relay-l1-l5] Device admission checks the one-time secret, revocation, and account policy inside one commit.[^pinomad-admit-l47-l54]
5. **Credentials live beside the host data.** `ModelRuntime.create` reads `<dataDir>/auth.json` and `models.json`. The host does not read `~/.pi/agent`.[^pinomad-credentials-l152-l157][^pinomad-adr-0031-l20-l22] Login prompts are forwarded to the client. ADR-0031 says answers are not echoed back onto the providers stream.

**llame fit**

- High: item 1's client-versus-host split, and the explicit non-replay of bash, write, and edit.
- Moderate: items 3 and 4 for workspace binding and pairing that fails closed inside one commit.
- Low: item 5's credential file layout.
- Avoid: item 2. A paired phone with unbounded host shell is personal-device trust, not llame's approval and RLS boundary. Pi Durable's codemode and virtual models stay in [Earendil Pi](./earendil-pi.md); this note does not restate them.

**Caution:** There is no per-tool approval and no OS sandbox around bash in the host code reviewed here.[^pinomad-coding-l26-l27] The relay sees ciphertext payloads and plaintext control frames.[^pinomad-relay-l1-l5] Hosts do not sync conversations with each other. ADR-0009's older sentence about `~/.pi/agent` credentials is superseded by ADR-0031.[^pinomad-adr-0031-l20-l22]

[^pinomad-license-l1-l4]: [Apache License 2.0 heading](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/LICENSE#L1-L4)

[^pinomad-readme-license-l49]: [Apache-2.0, with Pi notices under docs/licenses](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/README.md#L49)

[^pinomad-host-package-l11-l16]: [Pi Durable and related packages pinned at 1.4.0](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/package.json#L11-L16)

[^pinomad-adr-0002-l7-l12]: [Durable storage is the runtime; several clients share one session](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/docs/adr/0002-pi-durable-as-runtime.md#L7-L12)

[^pinomad-data-dir-l6-l7]: [Default data directory is ~/.pinomad unless PINOMAD_DATA_DIR is set](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/cli/host-address.ts#L6-L7)

[^pinomad-host-open-l219-l223]: [One execution environment per cwd, and session.sqlite in the data dir](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/host.ts#L219-L223)

[^pinomad-host-env-l247-l250]: [NodeExecutionEnv is constructed for that cwd](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/host.ts#L247-L250)

[^pinomad-host-resume-l333-l334]: [Startup calls harness.resume](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/host.ts#L333-L334)

[^pinomad-host-close-l372]: [Close writes no tool outcome](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/host.ts#L372)

[^pinomad-adr-0009-l16]: [bash, write, and edit are not replayed after an interrupt](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/docs/adr/0009-host-lifecycle.md#L16)

[^pinomad-coding-l26-l27]: [read, write, edit, and bash run with no approval gate](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/extensions/coding.ts#L26-L27)

[^pinomad-adr-0011-l14-l16]: [ask_user_question replaces an approval gate](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/docs/adr/0011-ask-user-question-replaces-approval.md#L14-L16)

[^pinomad-checkout-l194-l207]: [A git project defaults to a worktree; a plain project sets cwd](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/organization.ts#L194-L207)

[^pinomad-chat-cwd-l247-l250]: [A Chat cwd is a directory under the data dir](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/organization.ts#L247-L250)

[^pinomad-protocol-l88-l96]: [Protocol 5.25; a different major version cannot talk](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/packages/protocol/src/frames.ts#L88-L96)

[^pinomad-relay-l1-l5]: [The relay forwards Noise ciphertext; control frames are plaintext](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/packages/protocol/src/relay.ts#L1-L5)

[^pinomad-admit-l47-l54]: [Device admission is one commit](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/devices.ts#L47-L54)

[^pinomad-credentials-l152-l157]: [auth.json and models.json live in the data directory](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/apps/host/src/main.ts#L152-L157)

[^pinomad-adr-0031-l20-l22]: [The host no longer reads Pi's credential files](https://github.com/bubbleptr/pinomad/blob/ea50587ea0ad10b484b4a17c8e521b0706a3db42/docs/adr/0031-host-owns-credentials-and-providers.md#L20-L22)
