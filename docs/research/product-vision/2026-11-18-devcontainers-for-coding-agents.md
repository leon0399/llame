---
type: Research
title: "Dev containers for coding agents"
description: "Evidence on devcontainer recipe realization, host privilege surfaces, agent injection, Nix patterns, and egress controls."
tags: [devcontainers, coding-agents, sandbox, provisioning, recipe-trust]
status: stable
observed:
  date: 2026-11-18
  revisions:
    devcontainers-spec: c95ffeed1d059abfe9ffbe79762dc2fa4e7c2421
    devcontainers-cli: a190a3f86fe20b582c25c4dcb7bbf5fdb739ab26
    coder-envbuilder: a5b73298362c9774c1c00f7fca64b023fdcbe760
    devcontainers-features: b6877129e0a264b8e83a63e8b93de29077132e5b
    anthropics-claude-code: 52dd3a11c3a87f79b06d353cdf8eea1bc52854dc
    dirien-devcontainer-coding-agents: fada47b2b3be30425d73fb7eacb7e0d1afd530a9
sources:
  - id: claude-devcontainer
    title: "Claude Code: Development containers"
    url: https://code.claude.com/docs/en/devcontainer
  - id: agentpatterns-devcontainers
    title: "Dev Containers for AI Coding Agents: Claude Code vs Copilot CLI"
    url: https://agentpatterns.ai/workflows/devcontainers-for-ai-coding-agents/
  - id: dirien-devcontainer
    title: "Coding Agent Sandbox"
    url: https://github.com/dirien/devcontainer-coding-agents/tree/fada47b2b3be30425d73fb7eacb7e0d1afd530a9
  - id: oyren-devcontainers
    title: "Devcontainers for AI coding agents: setup and boundaries"
    url: https://oyren.ai/blog/devcontainers-ai-coding-agents
  - id: phelps-devcontainers
    title: "Running AI agents in devcontainers"
    url: https://markphelps.me/posts/running-ai-agents-in-devcontainers/
  - id: devcontainer-spec
    title: "Development Container Specification: devcontainer.json"
    url: https://github.com/devcontainers/spec/blob/c95ffeed1d059abfe9ffbe79762dc2fa4e7c2421/docs/specs/devcontainerjson-reference.md
  - id: devcontainer-schema
    title: "Development Container Specification base schema"
    url: https://github.com/devcontainers/spec/blob/c95ffeed1d059abfe9ffbe79762dc2fa4e7c2421/schemas/devContainer.base.schema.json
  - id: devcontainer-cli
    title: "Dev Container CLI"
    url: https://github.com/devcontainers/cli/tree/a190a3f86fe20b582c25c4dcb7bbf5fdb739ab26
  - id: codespaces-intro
    title: "GitHub Codespaces: Introduction to dev containers"
    url: https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/introduction-to-dev-containers
  - id: devpod-overview
    title: "What is DevPod?"
    url: https://devpod.sh/docs/what-is-devpod
  - id: envbuilder
    title: "Coder Envbuilder"
    url: https://github.com/coder/envbuilder/tree/a5b73298362c9774c1c00f7fca64b023fdcbe760
  - id: envbuilder-support
    title: "Envbuilder devcontainer spec support"
    url: https://github.com/coder/envbuilder/blob/a5b73298362c9774c1c00f7fca64b023fdcbe760/docs/devcontainer-spec-support.md
  - id: nix-feature
    title: "Dev Container Nix Feature"
    url: https://github.com/devcontainers/features/tree/b6877129e0a264b8e83a63e8b93de29077132e5b/src/nix
  - id: nix-develop
    title: "Nix manual: nix develop"
    url: https://nix.dev/manual/nix/2.34/command-ref/new-cli/nix3-develop.html
  - id: nix-dev-env
    title: "Zero to Nix: Development environments"
    url: https://zero-to-nix.com/concepts/dev-env/
  - id: docker-security
    title: "Docker Engine security"
    url: https://docs.docker.com/engine/security/
  - id: codespaces-policy
    title: "GitHub Codespaces: Restricting the base image"
    url: https://docs.github.com/en/codespaces/managing-codespaces-for-your-organization/restricting-the-base-image-for-codespaces
  - id: claude-firewall
    title: "Claude Code reference container firewall"
    url: https://github.com/anthropics/claude-code/blob/52dd3a11c3a87f79b06d353cdf8eea1bc52854dc/.devcontainer/init-firewall.sh
  - id: claude-container-config
    title: "Claude Code reference container configuration"
    url: https://github.com/anthropics/claude-code/blob/52dd3a11c3a87f79b06d353cdf8eea1bc52854dc/.devcontainer/devcontainer.json
  - id: claude-firewall-docs
    title: "Claude Code network access requirements"
    url: https://code.claude.com/docs/en/network-config#network-access-requirements
---

# Dev containers for coding agents

## Summary

A devcontainer is a **recipe plus an implementation contract**, not by itself a trust boundary. The common interface specifies a container image/build, workspace and lifecycle customization; an implementation still chooses where the builder/runtime run, which fields it honors, and what host services it exposes. Codespaces, DevPod, Envbuilder and `@devcontainers/cli` therefore provide useful precedent for different realization topologies, but none makes arbitrary repository-supplied configuration safe. A daemon that accepts recipes needs a trust policy before it executes host-side initialization, builds images/features, runs lifecycle scripts, binds mounts, or grants container privileges. [^devcontainer-spec] [^devcontainer-cli] [^devpod-overview] [^envbuilder]

| Decision dimension             | What the evidence shows                                                                                                                                                                                                                | Confidence |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Who realizes the recipe?       | Codespaces owns VM/container provisioning; DevPod chooses a provider then applies the shared recipe; Envbuilder builds in an outer container/Kubernetes-oriented workflow; CLI delegates locally to Docker/Compose.                    | High       |
| Does the spec imply isolation? | No: arbitrary host initialization, arbitrary in-container lifecycle commands, host mounts, capabilities and raw runtime arguments are expressible.                                                                                     | High       |
| How does agent code arrive?    | Usually baked into the image via Dockerfile or a Feature; alternatively injected at launch by a separately trusted bootstrap. The agent process needs its runtime (for example Node for a Node CLI) or a compatible static executable. | High       |
| What is the policy boundary?   | Trust the recipe/build inputs and select/allowlist dangerous fields before execution; do not rely on an agent's in-container permissions to protect host-accessible mounts, credentials, daemon sockets, or network.                   | High       |

## Scope and source quality

The five practitioner/vendor examples requested in ticket #1789 are all covered below: Claude Code's editor/container model, Agent Patterns' Claude/Copilot comparison, the dirien multi-agent image, Oyren's lifecycle/security guide, and Mark Phelps' mounted-agent workflow. Official specification and product documentation ground normative behavior; practitioner examples are treated as designs, not security guarantees. [^claude-devcontainer] [^agentpatterns-devcontainers] [^dirien-devcontainer] [^oyren-devcontainers] [^phelps-devcontainers]

## Recipe realization precedents

| System               | Realization topology and useful behavior                                                                                                                                                                                                                                                                                                                                   | What it does not establish                                                                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Codespaces    | A Codespace uses a dev container hosted on a VM. Repository `.devcontainer` configuration selects an image or Dockerfile, features, toolchain and extensions; several configurations can be offered. Organization policy can restrict base images. [^codespaces-intro] [^codespaces-policy]                                                                                | The recipe is not necessarily a trusted policy source just because GitHub builds it. An allowed image policy controls base images, not arbitrary lifecycle code or every privilege-affecting field. [^codespaces-intro] [^codespaces-policy]                           |
| DevPod               | Client-side orchestration chooses among providers for local machines, reachable remote machines, public/private cloud; each provider produces a workspace using the same devcontainer recipe. Its overview describes no server backend requirement. [^devpod-overview]                                                                                                     | Portability of recipe does not make providers equivalent in isolation, host-access policy, networking or persistence. Provider choice is a second policy axis. [^devpod-overview]                                                                                      |
| Coder Envbuilder     | Builds a repository's Dockerfile/devcontainer configuration from an outer Envbuilder runtime, caches image layers, and launches an init command in the result; it supports Docker, Kubernetes and OpenShift. Its upstream README says it is in maintenance mode and points Coder users to its built-in Dev Containers CLI integration. [^envbuilder] [^envbuilder-support] | Envbuilder is not a security sandbox claim, and its supported-spec matrix is implementation-specific. Avoid treating it as Coder's current recommended integration. [^envbuilder]                                                                                      |
| `@devcontainers/cli` | Open-source TypeScript reference implementation: `build`, `up`, lifecycle commands, configuration inspection and `exec`. It can run locally and supports Docker/Compose workflows; the CLI docs describe lockfiles that pin feature versions. [^devcontainer-cli]                                                                                                          | Reference implementation means executable behavioral precedent, not a security policy or hosted executor. Invoking it on an untrusted checkout exposes the machine running it to all host-side portions of the configuration. [^devcontainer-cli] [^devcontainer-spec] |

The shared format intentionally gives tools room to add editor-specific metadata, lifecycle behavior and orchestration. Separate recipe parsing from execution: a provisioned computer can receive a normalized recipe and let a local builder/runtime realize it, or a trusted control plane can resolve/build an image first and send the resulting artifact to a runtime. The spec does not choose between those architectures. [^devcontainer-spec] [^devcontainer-cli]

## Host execution and privilege expansion in `devcontainer.json`

This is the security-focused field inventory. “Host” means the machine or service that runs the container engine/builder; for a remote VM that is the provisioned VM, not necessarily the llame control plane. Source links identify the specification/schema definition. Values may be templated, so trust decisions must evaluate resolved inputs too. [^devcontainer-spec] [^devcontainer-schema]

| Field / mechanism                                                                                                                                                                                               | Runs on host or privilege effect                                                                                                                                                                                                                                                    | Recipe-review consequence                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`initializeCommand`](https://containers.dev/implementors/spec/#lifecycle-scripts)                                                                                                                              | Runs on the host before container creation, including repeated start/reopen events (the lifecycle is specified by the implementor reference).                                                                                                                                       | Treat as arbitrary host-code execution. Never run it from an untrusted repository without a separate trust gate or a host with an acceptably small blast radius.                                         |
| [`mounts`](https://containers.dev/implementors/spec/#devcontainerjson)                                                                                                                                          | Adds Docker mount points. `type=bind` exposes host paths; `type=volume` exposes persistent engine-managed state. A mount targeting `/var/run/docker.sock` grants access to the host Docker API, which Docker says can permit root-level host filesystem changes. [^docker-security] | Resolve and classify source paths; block host roots, credential paths and engine sockets by default. Named volumes need explicit lifecycle/owner scoping to avoid cross-project credential/data sharing. |
| `workspaceMount` (and default workspace bind mount)                                                                                                                                                             | Binds the checkout into the container; changes made there are host-visible. Specification defines workspace mount configuration. [^devcontainer-spec]                                                                                                                               | Workspace is an intentionally writable host data path, not an immutable container layer. Use a disposable worktree/checkout if rollback or separation is required.                                       |
| [`privileged`](https://github.com/devcontainers/spec/blob/main/schemas/devContainer.base.schema.json)                                                                                                           | Maps to Docker `--privileged`, substantially broadening device/capability access.                                                                                                                                                                                                   | Reject by default; if required for a workload, isolate the outer executor more strongly and make this an explicit reviewed grant.                                                                        |
| [`capAdd`](https://github.com/devcontainers/spec/blob/main/schemas/devContainer.base.schema.json)                                                                                                               | Adds Linux capabilities to the container. A firewall example needs `NET_ADMIN` (and uses `NET_RAW`); Docker documents that adding capabilities can make container security weaker. [^docker-security] [^claude-firewall-docs]                                                       | Allowlist individual capabilities for named use cases; do not accept arbitrary arrays as benign environment preferences.                                                                                 |
| [`securityOpt`](https://github.com/devcontainers/spec/blob/main/schemas/devContainer.base.schema.json)                                                                                                          | Passes runtime security options; e.g. `seccomp=unconfined` relaxes a host-enforced syscall filter. [^devcontainer-schema]                                                                                                                                                           | Reject weakening options unless an operator-defined policy permits them.                                                                                                                                 |
| [`runArgs`](https://containers.dev/implementors/spec/#devcontainerjson)                                                                                                                                         | Passes Docker run arguments; this raw escape hatch can request extra mounts, devices, namespaces, capabilities, security opts or other host runtime configuration.                                                                                                                  | Parse into an allowlisted runtime model instead of forwarding arbitrary strings. Identify duplicate/override forms and options requiring daemon-level authority.                                         |
| [`containerUser`](https://github.com/devcontainers/spec/blob/main/schemas/devContainer.base.schema.json), [`remoteUser`](https://github.com/devcontainers/spec/blob/main/schemas/devContainer.base.schema.json) | Selects container default or tool/lifecycle process identity. Root does not automatically equal host root under user namespaces, but it increases in-container authority and can combine dangerously with other grants. [^docker-security]                                          | Enforce a non-root workload identity when possible; never treat `remoteUser` as host isolation.                                                                                                          |
| [`dockerComposeFile`](https://containers.dev/implementors/spec/#docker-compose)                                                                                                                                 | Selects Compose configuration that can carry Docker-equivalent mounts, privileges, devices and network settings. [^devcontainer-spec]                                                                                                                                               | Validate the referenced Compose config too; validating only JSON is incomplete.                                                                                                                          |
| [`build.dockerfile`, `build.context`, `image`, `features`](https://containers.dev/implementors/spec/#image-build)                                                                                               | Build instructions and Feature install scripts execute during image construction in the builder's environment and can fetch external inputs. The spec exposes these recipe inputs; CLI builds them. [^devcontainer-spec] [^devcontainer-cli]                                        | Pin image and Feature references, restrict build context/secrets/network as appropriate, and treat Dockerfile/Feature authorship as trusted executable supply chain.                                     |
| [`forwardPorts`, `appPort`](https://containers.dev/implementors/spec/#devcontainerjson)                                                                                                                         | Arranges host/editor access to container services; it can expose a development server beyond the container depending on implementation. [^devcontainer-schema]                                                                                                                      | Keep forwarding scoped to the user/session, not a blanket host/network exposure.                                                                                                                         |

`postCreateCommand`, `postStartCommand`, `postAttachCommand`, `onCreateCommand`, and `updateContentCommand` run inside the container rather than directly on the host, but they are arbitrary commands from the recipe. They can still write mounted host files, use the Docker socket if mounted, access injected secrets, and send traffic over allowed egress. They are not a safe subset just because the shell is containerized. [^devcontainer-spec] [^claude-devcontainer] [^docker-security]

### Recipe trust implications

A repository-provided recipe controls more than tool versions: it can request host initialization, supply build-time scripts, mount host state, broaden runtime privileges, and execute lifecycle commands. Trust should therefore attach to an authenticated recipe revision and the executable dependencies it references, rather than to the “devcontainer” label or a successful image build. For untrusted contributions, an outer boundary should protect the machine that runs the builder and runtime; inside-container controls cannot revoke a host mount or Docker API already granted. This is a synthesis from the spec execution surfaces and Docker's daemon security model. [^devcontainer-spec] [^devcontainer-cli] [^docker-security]

A practical trust gradient is: (1) operator-owned/approved recipe and pinned dependencies; (2) unreviewed but constrained recipe, with host-run command disabled and a locked-down builder/runtime; (3) arbitrary recipe only inside a separately disposable machine with no host credentials/socket and limited network. This is a recommendation, not a vendor-defined policy. [INFERENCE]

## Nix: two distinct patterns

**Nix within a devcontainer.** The official Nix Feature installs Nix and optionally packages or a flake URI. It documents multi-user and single-user install trade-offs; multi-user requires root or sudo support for daemon startup. Its documented flake URI works best remotely because local flake files need to be present in the image; current guidance uses a lifecycle command for a local checkout. An optional `/nix` volume can accelerate rebuilds, but the mount is persistent state and should be project-scoped. [^nix-feature]

Patterns include adding `ghcr.io/devcontainers/features/nix:1`, baking Nix into a Dockerfile, then running `nix develop` after workspace attachment against a checked-in `flake.nix`/`flake.lock`; or using the feature's remote `flakeUri` where it matches the workflow. The flake lock is the input-pinning mechanism; do not assume a floating flake reference is reproducible. [^nix-feature] [^nix-develop]

**Nix shell without a container.** `nix develop` starts a shell with the build environment of a flake's `devShells.<system>.default` (or package fallback), independently of Docker/devcontainers. It describes a reproducible tool environment, not a host isolation boundary: agent commands still run with the host user's filesystem/network privileges. [^nix-develop] [^nix-dev-env]

**Trade-off.** Containers package a broader OS/userspace and can provide namespaces/resource limits, but depend on host kernel/runtime trust and mounted paths. Nix shells are a composable toolchain/environment mechanism and can be nested inside containers; neither alone is a complete security Sandbox. [^docker-security] [^nix-develop] [INFERENCE]

## Injecting the agent or daemon

There are two concrete patterns:

1. **Bake it into the image.** Install the CLI in a Dockerfile or Dev Container Feature. Claude's Feature installs Node.js if absent, or supports explicitly adding the Node Feature; a pinned CLI version can instead be installed through npm with auto-update disabled. Dirien's example similarly puts several agent CLIs and language toolchains in one image. This yields a self-contained image but adds agent/runtime dependencies to recipe build and version policy. [^claude-devcontainer] [^dirien-devcontainer]
2. **Inject a trusted launcher at start/attach.** The Dev Container CLI example-usage describes injecting tools into a running dev container; Envbuilder supports an init script/command after build. A llame daemon could be delivered by a trusted provisioner/daemon supervisor rather than sourced from the repo. This is an architectural option, not a shipped devcontainer spec feature. [^devcontainer-cli] [^envbuilder] [INFERENCE]

The container must contain the process runtime needed by the injected artifact: for a Node CJS bundle, a compatible Node.js runtime (plus any required native/system libraries); a static native executable may avoid a language runtime but still requires a compatible OS/CPU/ABI and any dynamically linked libraries. That last compatibility statement is an implementation constraint, not a devcontainer-specific guarantee. [INFERENCE]

Do not conflate installing an agent CLI with injecting the executor daemon. Agent CLIs often require authentication/state; mounting the host's entire `~/.claude` or `~/.codex` is a common practitioner shortcut, but it shares credentials/configuration with the agent. Anthropic explicitly warns that reachable credentials can be exfiltrated by malicious project/agent activity; prefer short-lived, scoped credentials and per-executor state. [^phelps-devcontainers] [^claude-devcontainer]

## Egress firewall patterns

The Dev Container spec does not define an egress policy field; the runtime/networking layer owns it. The Claude Code reference demonstrates an in-container firewall: `iptables` default DROP, selective destinations (including GitHub, npm and provider/auth endpoints), and extra `NET_ADMIN`/`NET_RAW` capabilities. The docs say this is optional and can be replaced by network controls outside the container. [^claude-firewall] [^claude-firewall-docs] [^claude-container-config]

Other patterns are an external host/VM firewall or proxy with default-deny destination policy, and a dedicated egress gateway. These avoid granting an agent container `NET_ADMIN`; however, they must handle DNS, TLS endpoints, redirects, package mirrors, and provider authentication correctly. This is architectural synthesis. [INFERENCE]

An allowlist reduces destination reachability but is not proof against exfiltration: DNS or an allowed API/service can remain a channel, and required domains may be broad or dynamic. The Claude reference's own docs warn that container isolation does not prevent exfiltration of reachable credentials. Firewall policy therefore complements, rather than substitutes for, credential minimization and a host-boundary decision. [^claude-devcontainer] [^claude-firewall]

## Decision inputs for llame

- **Realization belongs to an explicit executor/runtime contract.** The recipe format is portable, but build location, host command policy, mount resolution, external build inputs, and supported feature set are implementation choices. [^devcontainer-spec] [^devcontainer-cli] [^devpod-overview] [^envbuilder]
- **Resolve trust before provisioning.** A recipe that can run `initializeCommand` or request the Docker socket/privilege is executable authority, not declarative metadata. Untrusted repositories need an outer disposable executor and stripped host credentials. [^devcontainer-schema] [^docker-security]
- **Make agent injection independent of recipe control.** Prefer the daemon/runtime to inject a pinned, trusted launcher; require its runtime in the image or provide a compatible static build. Keep optional user agent CLI and daemon lifecycle as distinct responsibilities. [INFERENCE]
- **Treat egress as host policy.** Prefer firewall/proxy rules enforced outside the image when recipes are untrusted; an in-container firewall is itself mutable by a privileged container. [^claude-firewall] [^devcontainer-schema] [INFERENCE]
- **Nix is an environment component, not an isolation primitive.** Support it in-image or as an independent host shell, but preserve lockfiles, pin the Feature, and scope persistent `/nix` state. [^nix-feature] [^nix-develop]

## Sources

[^claude-devcontainer]: Anthropic, [Development containers](https://code.claude.com/docs/en/devcontainer). Editor architecture, installation, persistence, host-secret warning, firewall and bypass-mode boundaries.

[^agentpatterns-devcontainers]: Agent Patterns, [Dev Containers for AI Coding Agents: Claude Code vs Copilot CLI](https://agentpatterns.ai/workflows/devcontainers-for-ai-coding-agents/). Vendor-feature comparison and Anthropic reference firewall synthesis; secondary source.

[^dirien-devcontainer]: Dirk Gommers, [devcontainer-coding-agents](https://github.com/dirien/devcontainer-coding-agents). Example image with Claude Code, Copilot, OpenCode, Codex, language/infrastructure tooling, and config persistence.

[^oyren-devcontainers]: Oyren AI Team, [Devcontainers for AI coding agents: setup and boundaries](https://oyren.ai/blog/devcontainers-ai-coding-agents). Lifecycle ordering, mounts, credentials, `devcontainer up/exec`; secondary, AI-written guide.

[^phelps-devcontainers]: Mark Phelps, [Running AI agents in devcontainers](https://markphelps.me/posts/running-ai-agents-in-devcontainers/). Practitioner example of bind-mounting agent state and trade-offs; its broad host-protection claims should be read against Docker security docs.

[^devcontainer-spec]: Development Containers Specification, [implementor reference](https://containers.dev/implementors/spec/). Defines JSON properties, lifecycle, image build and Compose integration.

[^devcontainer-schema]: Development Containers Specification, [base JSON schema](https://github.com/devcontainers/spec/blob/main/schemas/devContainer.base.schema.json). Field descriptions for mounts, privilege, capabilities, runtime args and users.

[^devcontainer-cli]: Development Containers, [CLI reference implementation](https://github.com/devcontainers/cli). Build/up/lifecycle/exec behavior and feature lockfiles.

[^codespaces-intro]: GitHub, [Introduction to dev containers](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/introduction-to-dev-containers). Codespaces VM/container topology and repository configurations.

[^devpod-overview]: DevPod, [What is DevPod?](https://devpod.sh/docs/what-is-devpod). Provider model across local, reachable remote and cloud environments.

[^envbuilder]: Coder, [Envbuilder repository](https://github.com/coder/envbuilder). Capabilities, usage and maintenance-status notice.

[^envbuilder-support]: Coder, [Envbuilder devcontainer spec support](https://github.com/coder/envbuilder/blob/main/docs/devcontainer-spec-support.md). Implementation-specific support matrix.

[^nix-feature]: Dev Container Features, [Nix Feature](https://github.com/devcontainers/features/tree/main/src/nix). Installation modes, feature options, flake and store guidance.

[^nix-develop]: Nix, [nix develop manual, 2.34](https://nix.dev/manual/nix/2.34/command-ref/new-cli/nix3-develop.html). Flake devShell resolution and shell behavior.

[^nix-dev-env]: Zero to Nix, [Development environments](https://zero-to-nix.com/concepts/dev-env/). Nix environment/closure concept; secondary tutorial.

[^docker-security]: Docker, [Engine security](https://docs.docker.com/engine/security/). Docker daemon authority, mounts, capabilities and namespaces.

[^codespaces-policy]: GitHub, [Restricting the base image for Codespaces](https://docs.github.com/en/codespaces/managing-codespaces-for-your-organization/restricting-the-base-image-for-codespaces). Organization-level base-image policy.

[^claude-firewall]: Anthropic, [Reference firewall script](https://github.com/anthropics/claude-code/blob/main/.devcontainer/init-firewall.sh). In-container default-deny egress example.

[^claude-container-config]: Anthropic, [Reference devcontainer configuration](https://github.com/anthropics/claude-code/blob/main/.devcontainer/devcontainer.json). Runtime capabilities and lifecycle wiring for reference firewall.

[^claude-firewall-docs]: Anthropic, [Network access requirements](https://code.claude.com/docs/en/network-config#network-access-requirements). Destinations and optional egress controls.
