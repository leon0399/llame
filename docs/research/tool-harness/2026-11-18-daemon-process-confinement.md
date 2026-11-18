---
type: Research
title: "Process-level confinement for the Machine daemon"
description: "Compares same-kernel process confinement primitives, egress enforcement, and agent-harness practice for llame's Machine daemon."
tags:
  - sandbox
  - process-confinement
  - machine-daemon
status: stable
observed:
  date: 2026-11-18
  revisions:
    codex: e58bf8f5233b51e7cd1679d947e3028c1ed91b06
    oh-my-pi: d49918fab2dba3986927f2d46721629ed0f3a02c
    openshell: v0.1.9
sources:
  - id: linux-landlock-6-14
    resource: "https://docs.kernel.org/6.14/userspace-api/landlock.html"
    title: "Linux kernel Landlock userspace API"
  - id: linux-seccomp-6-14
    resource: "https://docs.kernel.org/6.14/userspace-api/seccomp_filter.html"
    title: "Linux kernel seccomp filter documentation"
  - id: bubblewrap-manual
    resource: "https://man.archlinux.org/man/extra/bubblewrap/bwrap.1.en"
    title: "Bubblewrap manual"
  - id: ubuntu-userns
    resource: "https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces"
    title: "Ubuntu restricted unprivileged user namespaces"
  - id: srt-readme
    resource: "https://github.com/anthropics/sandbox-runtime"
    title: "Anthropic sandbox-runtime README"
  - id: codex-linux-sandbox
    resource: "https://github.com/openai/codex/blob/e58bf8f5233b51e7cd1679d947e3028c1ed91b06/codex-rs/linux-sandbox/README.md"
    title: "Codex Linux sandbox implementation README"
  - id: codex-sandbox-docs
    resource: "https://developers.openai.com/codex/concepts/sandboxing"
    title: "Codex sandbox documentation"
  - id: openshell-runtimes
    resource: "https://docs.nvidia.com/openshell/v0.1.9/how-it-works/sandboxes/runtimes"
    title: "NVIDIA OpenShell sandbox runtimes"
  - id: openshell-policy
    resource: "https://docs.nvidia.com/openshell/v0.1.9/get-started/tutorials/first-network-policy"
    title: "NVIDIA OpenShell first network policy"
  - id: omp-oh-my-pi
    resource: "https://github.com/can1357/oh-my-pi/tree/d49918bd"
    title: "oh-my-pi upstream source"
  - id: omp-llame-reference
    resource: "../harnesses/oh-my-pi.md"
    title: "llame oh-my-pi harness reference"
---

# Process-level confinement for the Machine daemon

## Summary

No single primitive gives a complete process sandbox. Landlock can enforce filesystem and (ABI 4+) TCP-port policy on the process that installs it and descendants; seccomp limits syscalls but is explicitly not a sandbox; bubblewrap builds an isolated namespace/filesystem view around a newly launched child; macOS Seatbelt similarly confines a process when it is launched under a profile. A proxy allowlist only controls egress if the sandbox cannot bypass the proxy. [^linux-landlock-6-14][^linux-seccomp-6-14][^bubblewrap-manual][^srt-readme]

llame's native file tools execute in the Machine daemon itself, not a command child. Therefore a child-only wrapper does not confine those tools. Linux Landlock and seccomp can self-restrict the daemon if installed early enough (before relevant threads and unrestricted children); bubblewrap cannot retroactively constrain an already-running daemon. macOS Seatbelt has a process-level API, but the reviewed harness evidence uses `sandbox-exec` to start a confined process; a launcher/profile around the daemon would be needed. [^linux-landlock-6-14][^linux-seccomp-6-14][^srt-readme]

## Mechanisms

| Mechanism | Guarantee and requirements | Container / Ubuntu constraints | Unavailable or failed setup | Daemon self-restriction? |
| --- | --- | --- | --- | --- |
| Landlock | Kernel-enforced, stackable path rights; ABI 4 adds TCP bind/connect port rules. ABI detection is runtime via `landlock_create_ruleset(...VERSION)`; supported features depend on ABI. ABI 1 filesystem baseline (Linux 5.13), ABI 2 `REFER` (5.19), ABI 3 `TRUNCATE` (6.2), ABI 4 network (6.7), ABI 5 device ioctl (6.10), ABI 6 scopes (6.12). Unprivileged process uses `PR_SET_NO_NEW_PRIVS` then `landlock_restrict_self`; no root required. | Runs against the container's host kernel and is subject to the container's seccomp/LSM restrictions; Docker does not itself guarantee Landlock syscall availability. Probe and test actual ruleset creation, not just host kernel version. The Ubuntu AppArmor userns restriction does not itself block Landlock (it does not require a user namespace); AppArmor may independently deny syscalls/policy. | Unsupported syscall/ABI, denied syscall, or ruleset/rule/restrict failure means no guarantee: mandatory policy must refuse daemon start, not continue unconfined. ABI <4 cannot enforce network port rules, so explicitly reject if those are required. | **Yes**, for current calling thread and descendants, but Landlock domains are per-thread; existing sibling Node threads are not automatically restricted. Apply before creating worker threads, or ensure every daemon thread installs equivalent restrictions. Existing file descriptors are not revoked. |
| seccomp-BPF | Kernel filters system-call number/arguments; reduces kernel attack surface, not a complete sandbox. Requires `CONFIG_SECCOMP_FILTER` and `PR_SET_NO_NEW_PRIVS=1` or `CAP_SYS_ADMIN` in its user namespace. Descendants inherit when fork/clone/exec permitted; filters stack. | Container seccomp profiles/capabilities can prohibit adding filters, even if host kernel supports them. Docker's own syscall filter is an additional layer, not a substitute for a daemon-specific policy. AppArmor's userns restriction is orthogonal. | Install errors must be fatal for mandatory policy. Forbidden calls fail according to configured action (errno, trap, or process/thread kill); bad filter design can break Node. It does not mediate pointer data or provide file path policy. | **Yes**, on installing thread and descendants; threads already running need synchronized application (e.g. seccomp TSYNC) or early installation. Do not allow ptrace in an untrusted seccomp sandbox. |
| bubblewrap + user namespaces | bwrap creates mount namespace and a new filesystem view; can additionally unshare user, PID, network, IPC, UTS, cgroup namespaces. Unprivileged bwrap ordinarily requires user namespaces; namespace isolation is not a VM and shares the kernel. | In a Docker worker, nested user/mount namespaces need container runtime/seccomp/AppArmor permission; host kernel config and outer policy apply. Ubuntu 24.04's AppArmor restriction can deny unprivileged userns creation for unconfined executables lacking a profile `userns,` rule (or `CAP_SYS_ADMIN`); a correctly loaded profile or delegated namespace is needed. Do not assume installing bwrap suffices. | Required `--unshare-user`/mount setup failure makes bwrap exit before command; do not use `--unshare-user-try`/other `-try` paths for a required boundary. A permissive bwrap profile is possible, so review mounts and inherited fds too. | **No** for an already-running daemon: it confines the command it launches. Could launch the daemon itself inside bwrap from its start, but that changes deployment/lifecycle and can disrupt daemon filesystem/stdio needs. |
| macOS Seatbelt (`sandbox-exec`) | Kernel sandbox profile restricts operations of launched process and descendants; SRT generates profiles for filesystem and networking. `sandbox-exec` is deprecated, and Apple does not provide a stable supported general-purpose public sandbox API contract comparable to Linux Landlock. | Not relevant inside Linux Docker workers; future native macOS personal Nodes only. Requires macOS Seatbelt support and usable profile/runtime. | Launcher/profile failure should block required sandbox startup. Do not silently launch unsandboxed. Reviewed SRT docs describe host `sandbox-exec`; they do not specify a robust fallback policy for every failure case. | **Not through the reviewed launcher path**: use a wrapper to launch the daemon. macOS has sandbox APIs capable of restricting the calling process, but this review did not establish a stable supported API for applying a new profile to an already running Node daemon. Treat self-confinement as unproven. |
| Egress proxy allowlist | Proxy resolves/filters destination host/domain; policy enforcement is meaningful only when direct network paths are denied. SRT routes Linux sandbox networking through Unix-socket-bound host proxy; macOS allows only local proxy port. Codex managed proxy uses isolated network namespace plus TCP-to-UDS bridge. OpenShell requires default-deny network policy and network enforcement. | For Docker, enforce no direct egress at network namespace/firewall/CNI level, then allow only proxy path; an env var like `HTTPS_PROXY` alone is advisory and bypassable. OpenShell docs explicitly warn Kubernetes CNI must enforce NetworkPolicy. | Proxy unavailable/policy invalid should fail closed (no connectivity); proxy allowlist cannot prevent non-network exfiltration or access to a reachable service that is itself overbroad. DNS/IP handling and CONNECT semantics must be explicit. | **Can**, if daemon's own network namespace/egress is fenced and it can reach only proxy. A child-only namespace does not constrain daemon native tools or sockets. Landlock ABI 4 port restrictions can narrow TCP ports, not hostnames; combine with external proxy/firewall. |

[^linux-landlock-6-14]: [Linux kernel Landlock userspace API](https://docs.kernel.org/6.14/userspace-api/landlock.html) documents ABI version discovery, filesystem/network rights, `PR_SET_NO_NEW_PRIVS`, self-restriction, thread and child inheritance, and layered policy. The ABI to release mapping follows the kernel Landlock ABI history and release tags: [v5.13](https://github.com/torvalds/linux/releases/tag/v5.13), [v5.19](https://github.com/torvalds/linux/releases/tag/v5.19), [v6.2](https://github.com/torvalds/linux/releases/tag/v6.2), [v6.7](https://github.com/torvalds/linux/releases/tag/v6.7), [v6.10](https://github.com/torvalds/linux/releases/tag/v6.10), [v6.12](https://github.com/torvalds/linux/releases/tag/v6.12). Exact feature detection at runtime is authoritative; distro backports can differ.
[^linux-seccomp-6-14]: [Linux kernel seccomp filter documentation](https://docs.kernel.org/6.14/userspace-api/seccomp_filter.html) states that seccomp is not a sandbox, specifies no-new-privileges or namespace capability requirement, inheritance, and filter behavior.
[^bubblewrap-manual]: [Bubblewrap manual](https://man.archlinux.org/man/extra/bubblewrap/bwrap.1.en) documents unprivileged operation, required user namespace absent root, namespace options, and optional `-try` behavior.
[^ubuntu-userns]: [Canonical's Ubuntu AppArmor user-namespace restriction overview](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces) explains that confined applications need `userns,` permission (or `CAP_SYS_ADMIN`) and unconfined applications without matching profiles can be blocked. Ubuntu 24.04 inherits the per-application restriction design; package/profile and system setting determine effective behavior.
[^srt-readme]: [Anthropic sandbox-runtime README](https://github.com/anthropics/sandbox-runtime) describes `sandbox-exec` Seatbelt on macOS, bubblewrap on Linux, process-tree application, default-deny network, filesystem Unix socket proxy on Linux, and a localhost proxy channel on macOS.

## Harness prior art

- **Claude Code / `@anthropic-ai/sandbox-runtime`:** wraps arbitrary commands/process trees; macOS uses `sandbox-exec`/Seatbelt, Linux uses bubblewrap and network namespaces, and proxy servers enforce HTTP/HTTPS and TCP allowlists. Linux routes via mounted Unix socket to host proxy; macOS permits a local proxy port. This is launcher-level confinement, not evidence that the daemon itself is retroactively restricted. README presents beta/research-preview status. [^srt-readme]
- **Codex:** Linux helper combines bubblewrap filesystem/user/PID/network namespaces with seccomp and `PR_SET_NO_NEW_PRIVS`; legacy Landlock exists but is not used for filesystem-restricted policy because it cannot isolate app-server Unix sockets. Missing bwrap can fall back to bundled helper with a warning; inability to create user namespaces warns, while WSL1 rejects sandboxed commands. Restricted policies requiring bwrap cannot silently become an unrestricted filesystem mode. [^codex-linux-sandbox]
- **NVIDIA OpenShell:** Docker/Podman/Kubernetes/MicroVM compute runtimes, with in-sandbox Landlock and seccomp qualification; microVM has no network interface, traffic routed through supervisor. Docker workloads retain `network=none`; corporate proxy failures do not degrade to direct egress. Kubernetes requires CNI NetworkPolicy enforcement or workloads could bypass policy. This is stronger outer isolation than a local wrapper, but still use the actual configured runtime and policy. [^openshell-runtimes]
- **oh-my-pi:** local `docs/research/harnesses/oh-my-pi.md` and inspected upstream repository describe task/subagent isolated worktrees and filesystem-oriented `pi-iso`, but no integrated Landlock/seccomp/bubblewrap/Seatbelt sandbox or OS-level egress fence was found. This is a bounded negative finding, not proof no optional third-party integration exists. Its ordinary native tools run in the agent process; workspace isolation is not process confinement. [^omp-llame-reference][^omp-oh-my-pi]

[^codex-linux-sandbox]: [Codex Linux sandbox README at pinned revision](https://github.com/openai/codex/blob/e58bf8f5233b51e7cd1679d947e3028c1ed91b06/codex-rs/linux-sandbox/README.md); [Codex sandbox overview](https://developers.openai.com/codex/concepts/sandboxing).
[^openshell-runtimes]: [NVIDIA OpenShell v0.1.9 runtime documentation](https://docs.nvidia.com/openshell/v0.1.9/how-it-works/sandboxes/runtimes) describes Landlock/seccomp qualification, Docker networking/proxy behavior, MicroVM, and the Kubernetes CNI enforcement requirement. [OpenShell first network policy tutorial](https://docs.nvidia.com/openshell/v0.1.9/get-started/tutorials/first-network-policy) explains default-deny network policy.
[^omp-llame-reference]: [llame's oh-my-pi reference](../harnesses/oh-my-pi.md) covers agent capabilities and isolated subagent worktrees; no OS-confinement evidence is recorded there.
[^omp-oh-my-pi]: [oh-my-pi upstream at inspected revision](https://github.com/can1357/oh-my-pi/tree/d49918bd); README and repository tree were inspected for sandbox primitives and documented workspace isolation. Absence is medium confidence because optional integrations or paths outside reviewed materials could exist.

## Decision implications

1. **Treat `Sandbox` as daemon-process confinement, not only command confinement.** Since native file tools run in the daemon, any architecture applying bwrap only when spawning shell commands leaves read/edit/write/grep and daemon network activity outside that child sandbox. [^linux-landlock-6-14][^bubblewrap-manual]
2. **A same-process Linux baseline is plausible:** initialize Landlock + seccomp at process startup before Node worker threads and before untrusted child creation. Landlock handles path restrictions; seccomp shrinks syscall surface. Startup probes must verify required ABI/features and successful enforcement, with fail-closed behavior. [^linux-landlock-6-14][^linux-seccomp-6-14]
3. **For process-tree view isolation, bwrap remains complementary:** launch the daemon inside it when filesystem/mount/PID/network namespaces are needed; nested container runtime and Ubuntu AppArmor userns permissions become provision-time requirements. [^bubblewrap-manual][^ubuntu-userns]
4. **Network policy must deny bypass, not merely configure a proxy.** Isolate the daemon's egress and route through an authenticated/controlled proxy; don't claim hostname allowlisting from Landlock port rules alone. [^linux-landlock-6-14][^srt-readme][^openshell-runtimes]
5. **On macOS, Seatbelt is viable for launcher-confined personal Nodes, but treat API/support status as a deployment risk.** SRT demonstrates current use, while `sandbox-exec` is deprecated; no equivalent Linux-style arbitrary daemon self-install behavior was established here. [^srt-readme]

## Confidence and limits

**High confidence** on Linux primitive semantics, prerequisites, and cited harness implementation details; **medium confidence** on practical behavior inside arbitrary Docker configurations and the negative oh-my-pi finding, because those depend on host/runtime policy and repository review scope. Kernel version-to-ABI mapping is a compatibility guide, not a deployment guarantee: query ABI and test every required right at provisioning time. This report is prior-art research, not a security audit or escape-resistance proof. No custom Docker worker or Seatbelt profile was executed.
