---
type: Reference
title: "OpenShell"
description: "Policy-enforced sandbox runtime: a gateway and trusted supervisor host a guest agent, and credentials stay outside the workload."
resource: "https://github.com/NVIDIA/OpenShell"
tags: [harness, sandbox, isolation, policy, credentials, workspace]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-10-22"
observed:
  date: "2026-10-22"
  revision: "07b7a74b62a42b9ab1dcc14cb224731108978dd9"
sources:
  - id: readme-l19
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/README.md#L19"
    title: "OpenShell is a runtime that enforces a declared policy around agent capabilities"
  - id: readme-how-l23-l27
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/README.md#L23-L27"
    title: "README: kernel enforcement and a formal check before a policy change"
  - id: readme-l39
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/README.md#L39"
    title: "The default sandbox image ships no agent"
  - id: readme-l14
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/README.md#L14"
    title: "README badge points at the live docs site"
  - id: readme-l52-l60
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/README.md#L52-L60"
    title: "Public skills teach another agent to drive the CLI, write policy, and debug gateways"
  - id: license-l1-l5
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/LICENSE#L1-L5"
    title: "Apache License 2.0 heading"
  - id: cargo-l12
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/Cargo.toml#L12"
    title: "Workspace package license is Apache-2.0"
  - id: cargo-tonic-l22
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/Cargo.toml#L22"
    title: "Workspace depends on tonic"
  - id: tags-listing
    resource: "https://github.com/NVIDIA/OpenShell/tags"
    title: "Unpinned tags listing; v0.1.5 was not diffed against this commit"
  - id: cli-workspace-l467-l476
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-cli/src/main.rs#L467-L476"
    title: "Global workspace flag defaults to default"
  - id: tui-screens-l26-l52
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-tui/src/app.rs#L26-L52"
    title: "TUI screens and focus panes: gateways, providers, sandboxes, policy, and logs"
  - id: tui-run-l89-l100
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-tui/src/lib.rs#L89-L100"
    title: "TUI run takes a connected gateway channel and a workspace"
  - id: cli-term-l4078-l4096
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-cli/src/main.rs#L4078-L4096"
    title: "openshell term builds a gRPC channel and launches the TUI"
  - id: tui-connect-l573-l599
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-tui/src/lib.rs#L573-L599"
    title: "Gateway switch reads auth_mode and loads an OIDC token or an mTLS channel"
  - id: tui-oidc-mtls-l602-l620
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-tui/src/lib.rs#L602-L620"
    title: "The OIDC channel may also attach mTLS files from the gateway directory"
  - id: tui-mtls-files-l641-l654
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-tui/src/lib.rs#L641-L654"
    title: "The mTLS branch reads ca.crt, tls.crt, and tls.key"
  - id: ssh-session-l117-l167
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-cli/src/ssh.rs#L117-L167"
    title: "SSH attach creates a gateway session over gRPC"
  - id: ssh-proxy-l1947-l2048
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-cli/src/ssh.rs#L1947-L2048"
    title: "ssh-proxy opens an SSH-relay TCP forward and copies stdin and stdout"
  - id: grpc-client-l2057-l2062
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-core/src/grpc_client.rs#L2057-L2062"
    title: "The supervisor opens the gateway channel"
  - id: docker-workload-l6096-l6141
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-docker/src/lib.rs#L6096-L6141"
    title: "Docker workload drops all capabilities and uses network none"
  - id: docker-supervisor-net-l5156-l5168
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-docker/src/lib.rs#L5156-L5168"
    title: "The Docker supervisor uses bridge or host networking"
  - id: podman-netns-l1638-l1641
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-podman/src/container.rs#L1638-L1641"
    title: "Podman workload network namespace mode is none"
  - id: k8s-fence-l129-l175
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-kubernetes/src/isolation.rs#L129-L175"
    title: "Kubernetes workload NetworkPolicy has an empty egress list"
  - id: qemu-nic-l188-l189
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-vm/src/runtime.rs#L188-L189"
    title: "QEMU launch args pass -nic none"
  - id: vm-loopback-l76-l127
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-vm/src/bin/openshell-vm-init.rs#L76-L127"
    title: "prepare_network brings loopback up and returns"
  - id: vm-init-script-l658-l672
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-vm/scripts/openshell-vm-sandbox-init.sh#L658-L672"
    title: "Guest init script sets the unprivileged port start and writes nameserver 127.0.0.53"
  - id: runtimes-mxc-l18-l24
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/docs/how-it-works/sandboxes/runtimes.mdx#L18-L24"
    title: "Runtime table marks Windows MXC coming soon"
  - id: prepare-capability-free-l50-l69
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/mod.rs#L50-L69"
    title: "Capability-free prepare installs a hard baseline, then the user ruleset"
  - id: enforce-capability-free-l84-l100
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/mod.rs#L84-L100"
    title: "enforce_capability_free applies each Landlock ruleset, then child seccomp"
  - id: pre-exec-l577-l583
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/process.rs#L577-L583"
    title: "pre_exec calls enforce_capability_free before exec"
  - id: prepare-child-l69-l77
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/process.rs#L69-L77"
    title: "The child sandbox uses the capability-free prepare path"
  - id: landlock-require-abi-l70-l87
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/landlock.rs#L70-L87"
    title: "The mandatory baseline requires Landlock ABI v3 or newer"
  - id: landlock-baseline-l131-l210
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/landlock.rs#L131-L210"
    title: "Capability-free baseline is a hard-requirement ruleset and skips .openshell"
  - id: landlock-workdir-l247-l253
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/landlock.rs#L247-L253"
    title: "include_workdir appends the working directory to the read-write list"
  - id: best-effort-unavailable-l260-l289
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/landlock.rs#L260-L289"
    title: "A best-effort user ruleset is omitted when Landlock is unavailable"
  - id: best-effort-enforce-l410-l448
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/landlock.rs#L410-L448"
    title: "best_effort restrict_self failure logs and returns success"
  - id: seccomp-header-l4-l17
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/seccomp.rs#L4-L17"
    title: "Workload seccomp is default-allow with targeted blocks"
  - id: seccomp-listener-l325-l351
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/linux/seccomp_notify.rs#L325-L351"
    title: "Workload listener syscall vector starts with socket, connect, bind, and listen"
  - id: broker-connect-l588-l589
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/network_broker.rs#L588-L589"
    title: "A notified connect is handled by the network broker"
  - id: freeze-l2249-l2347
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/boundary_server.rs#L2249-L2347"
    title: "A lost Sandbox Protocol connection freezes the workload, then terminates it after the recovery deadline"
  - id: reconnect-timeout-l89
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/boundary_server.rs#L89"
    title: "Authenticated reconnect timeout is 30 seconds"
  - id: confirm-resume-l2211-l2226
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/boundary_server.rs#L2211-L2226"
    title: "A successful confirm resumes a frozen workload"
  - id: architecture-agent-l176-l179
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/docs/about/architecture.mdx#L176-L179"
    title: "Architecture page: the agent shares the sandbox side and holds no provider credentials"
  - id: architecture-same-process-l181-l183
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/docs/about/architecture.mdx#L181-L183"
    title: "Architecture page says only the same supervisor process can resume"
  - id: default-policy-l965-l994
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-policy/src/lib.rs#L965-L994"
    title: "Restrictive default includes the workdir, best-effort Landlock, and no network rules"
  - id: policy-discovery-l2630-l2666
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor/src/lib.rs#L2630-L2666"
    title: "A configuration error retries; otherwise a missing policy uses image discovery or the restrictive default"
  - id: egress-deny-l623-l660
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/opa.rs#L623-L660"
    title: "A recorded fail-closed reason denies egress; otherwise only action allow is allowed"
  - id: prover-findings-l4-l24
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-prover/src/finding.rs#L4-L24"
    title: "Prover findings are categorical and any finding blocks auto-approval"
  - id: link-local-host-l58-l66
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-prover/src/queries.rs#L58-L66"
    title: "Link-local findings also match metadata.google.internal"
  - id: prover-both-l144-l181
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-prover/src/queries.rs#L144-L181"
    title: "One model records both credential-reach and capability paths; the gateway delta keeps the category"
  - id: finding-delta-l1065-l1129
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/grpc/policy.rs#L1065-L1129"
    title: "finding_delta drops baseline paths and suppresses capability paths covered by new reach"
  - id: auto-approve-l1803-l1867
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/grpc/policy.rs#L1803-L1867"
    title: "Auto-approval requires no global policy, the prover string no new findings, and empty security notes"
  - id: review-token-l1753-l1792
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/grpc/policy.rs#L1753-L1792"
    title: "A stale review token fails closed and asks for a refetch"
  - id: platform-admin-l253-l262
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/auth/workspace_authz.rs#L253-L262"
    title: "An empty admin role makes is_platform_admin return true"
  - id: authorize-match-l144-l216
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/auth/workspace_authz.rs#L144-L216"
    title: "User principals with an empty admin role get platform admin; sandbox principals do not"
  - id: admin-role-comment-l370-l372
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/lib.rs#L370-L372"
    title: "admin_role is empty when OIDC is not configured"
  - id: admin-role-test-l593-l599
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/auth/workspace_authz.rs#L593-L599"
    title: "Test: empty admin role authorizes a user with no roles as platform admin"
  - id: workspace-root-l30-l32
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-core/src/driver_mounts.rs#L30-L32"
    title: "Default container workspace root is /sandbox"
  - id: oci-workdir-l101-l111
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-core/src/driver_mounts.rs#L101-L111"
    title: "Empty OCI WorkingDir and / fall back to /sandbox"
  - id: docker-resolve-workdir-l4626-l4627
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-docker/src/lib.rs#L4626-L4627"
    title: "Docker resolves the OCI working directory before writing boundary state"
  - id: docker-write-workdir-l4723-l4726
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-docker/src/lib.rs#L4723-L4726"
    title: "Docker writes the resolved workspace root to the workspace-root file"
  - id: docker-read-workdir-l5243-l5245
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-docker/src/lib.rs#L5243-L5245"
    title: "Docker reads the workspace-root file before building the supervisor command"
  - id: docker-workdir-arg-l5326-l5332
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-docker/src/lib.rs#L5326-L5332"
    title: "Docker passes that workspace-root string to the supervisor as --workdir"
  - id: inject-provider-l169-l175
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/process.rs#L169-L175"
    title: "Provider env injection skips supervisor-only keys"
  - id: child-cwd-l510-l527
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/process.rs#L510-L527"
    title: "The parent command drops supervisor-only env, injects provider env, and sets the child cwd"
  - id: supervisor-env-l111-l123
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/process.rs#L111-L123"
    title: "Supervisor-only env includes the sandbox token and TLS key"
  - id: tls-refuse-l7021-l7059
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/proxy.rs#L7021-L7059"
    title: "Missing TLS termination refuses CONNECT with HTTP 503 unless tls skip is set"
  - id: body-placeholder-l628-l640
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/relay.rs#L628-L640"
    title: "BodyCredentialError response is HTTP 403 and says body rewriting is disabled"
  - id: proxy-body-403-l6715-l6724
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/proxy.rs#L6715-L6724"
    title: "A BodyCredentialError from the relay is written as that 403"
  - id: schema-body-flags-l288-l299
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-policy-schema/src/lib.rs#L288-L299"
    title: "REST and WebSocket body credential rewrite default to false"
  - id: rest-body-rewrite-l1200-l1215
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/rest.rs#L1200-L1215"
    title: "request_body_credential_rewrite rewrites a REST body and writes it upstream"
  - id: deny-uninspected-l463-l465
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/mod.rs#L463-L465"
    title: "deny_uninspected_body_credentials is false when allow_uninspected_credentials is set"
  - id: rest-forward-body-l1232-l1248
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/rest.rs#L1232-L1248"
    title: "The remaining REST branch writes rewritten headers and relays the remaining body"
  - id: middleware-then-forward-l1426-l1537
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/relay.rs#L1426-L1537"
    title: "An allowed L7 request runs middleware before forward_inspected_request"
  - id: prepare-grant-l175-l183
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/relay.rs#L175-L183"
    title: "Token-grant injection runs only when a pinned credential has token_grant"
  - id: forward-credentials-l681-l740
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/relay.rs#L681-L740"
    title: "Forwarding prepares a token grant, then relays with a secret resolver"
  - id: token-grant-l5-l18
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/token_grant.rs#L5-L18"
    title: "Token grant, when configured, intercepts a provider request and injects Authorization"
  - id: mcp-versions-l25-l43
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-policy-schema/src/lib.rs#L25-L43"
    title: "Authored MCP revisions are a closed set; the default is 2025-11-25"
  - id: mcp-protocol-l14-l20
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-core/src/mcp.rs#L14-L20"
    title: "is_mcp_protocol matches the policy name mcp"
  - id: mcp-module-l1-l16
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/mcp.rs#L1-L16"
    title: "MCP module selects a Streamable HTTP revision and validates request metadata"
  - id: mcp-reject-l330-l367
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/relay.rs#L330-L367"
    title: "An invalid MCP request is HTTP 400 and returns before forward"
  - id: inference-model-l94-l95
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/docs/how-it-works/inference.mdx#L94-L95"
    title: "Provider attachment does not select or rewrite a model"
  - id: inference-workload-l311-l316
    resource: "https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/docs/how-it-works/inference.mdx#L311-L316"
    title: "The workload controls model selection after provider attachment"
  - id: vision-execution-l78-l88
    resource: "https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/VISION.md#L78-L88"
    title: "The harness owns execution; credentials and approvals stay out of prompts"
  - id: vision-sandbox-l186-l206
    resource: "https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/VISION.md#L186-L206"
    title: "Surface, Node, Workspace, and Sandbox stay separate; sandbox failure never silently downgrades"
  - id: spec-boundary-l35
    resource: "https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/SPEC.md#L35"
    title: "Sandbox is not a current runtime object; an entered Workspace is an executor binding"
  - id: spec-approval-l77
    resource: "https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/SPEC.md#L77"
    title: "Operator permissions ship; interactive approval does not"
  - id: spec-exec-l108-l110
    resource: "https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/SPEC.md#L108-L110"
    title: "Execution is pg-boss plus RunExecutionService; remote Machines move tool execution only"
  - id: spec-bash-l292-l301
    resource: "https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/SPEC.md#L292-L301"
    title: "Shipped bash is host-user authority; a managed Sandbox adapter is future"
  - id: roadmap-cli-l171-l191
    resource: "https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/ROADMAP.md#L171-L191"
    title: "Standalone personal Node and CLI remain unselected backlog"
  - id: roadmap-sandbox-l193-l218
    resource: "https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/ROADMAP.md#L193-L218"
    title: "Local Sandbox execution is sequenced after the Node runtime and remains capability design"
---

# OpenShell

- **Stack:** Rust workspace (`tonic` gRPC, Landlock, seccomp user notification); Apache-2.0.[^cargo-tonic-l22][^license-l1-l5][^cargo-l12]

**Status:** Source inspection of `07b7a74b62a42b9ab1dcc14cb224731108978dd9` on `main`. The program was not run. No sandbox was created, and no Landlock, seccomp, Docker, Podman, Kubernetes, or QEMU fence was executed. A GitHub tags listing, which is a live unpinned page, names release `v0.1.5` at `bdb956f2cd65a635f1294fccf1d138d263bf650f`. This shallow clone does not contain that tag, and this note does not diff the two commits.[^tags-listing] The README badge points at `https://docs.nvidia.com/openshell/latest/index.html`. That site is a live unpinned page and was not used as evidence.[^readme-l14]

OpenShell is a sandbox and execution runtime for a guest agent process. The README describes a runtime that gives agents file, package, API, and credential use under a declared policy.[^readme-l19] The following README section says OpenShell instruments the kernel for file, syscall, and network checks, and uses formal verification before a policy change is applied. It also says agents never see real credentials.[^readme-how-l23-l27] The default sandbox image is minimal Ubuntu and ships no agent. A real agent is something the operator installs and starts inside the sandbox.[^readme-l39] The gateway, supervisor, and sandbox paths read for this note do not implement a chat transcript or a model tool schema. The architecture page says the agent shares the sandbox side of the boundary and that the sandbox holds no provider credentials.[^architecture-agent-l176-l179] OpenShell owns the gateway, the trusted supervisor, and the isolation boundary around that guest. This reference sits under harnesses because that index holds software that hosts agent execution, including the other sandbox control planes. The tools index is for components a hosting harness calls.

llame's VISION separates Surface, Node, executor, Workspace, and Sandbox. Sandbox failure never silently downgrades to native execution.[^vision-sandbox-l186-l206] SPEC says that Sandbox is not a current runtime object. An entered Workspace is an owner-scoped binding on the configured native executor or on an experimental remote Machine. Remote Machines move tool execution over SSH. The Run loop, credentials, and native effect fence stay on the hub. No Node protocol ships.[^spec-boundary-l35][^spec-exec-l108-l110] Shipped `bash` runs as the host OS user, or as the remote host's login user when `cwd` is `machine://` or `ssh://`. A managed Sandbox adapter is named as future work.[^spec-bash-l292-l301] ROADMAP leaves the standalone personal Node and CLI unselected, and sequences local Sandbox execution after that Node runtime. The Nix, container, process-confinement, or VM realization remains capability design.[^roadmap-cli-l171-l191][^roadmap-sandbox-l193-l218] The findings below describe OpenShell. They leave those llame designs undecided.

**Study**

1. **The guest runs on the untrusted side of a boundary the supervisor owns.** The supervisor opens its gateway channel more than once. Policy load and the later polling loop must share credential slots, or the credentials handed to the middleware registry are not the ones the loop rotates.[^grpc-client-l2057-l2062] On the workload side, losing the Sandbox Protocol connection freezes the running process, records a recovery id, and waits `AUTHENTICATED_RECONNECT_TIMEOUT`, which is 30 seconds. When that id is still current at the deadline, the runtime marks the session terminating and stops the workload.[^freeze-l2249-l2347][^reconnect-timeout-l89] A later `commit_confirm` while the session is frozen calls `resume()` and, on success, clears the freeze.[^confirm-resume-l2211-l2226] The architecture page says only the same supervisor process can resume a running sandbox, including when the newcomer has valid credentials.[^architecture-same-process-l181-l183] The confirm function I read resumes after a successful confirm. It does not, in that function, compare a process id with the previous supervisor. Whether an earlier attach check rejects a different supervisor instance was not traced. High confidence for the freeze, the 30-second deadline, and the confirm resume. The same-process rule remains a page claim. VISION already says identity, credentials, authorization, approvals, and audit stay out of prompts and out of model-controlled sandboxes, and that sandbox failure never silently downgrades to native execution.[^vision-execution-l78-l88][^vision-sandbox-l186-l206] OpenShell is evidence for that split. It is not a decision to adopt this control plane. llame's shipped execution remains pg-boss and `RunExecutionService`.[^spec-exec-l108-l110]
2. **The CLI and the TUI are gRPC clients of a selected gateway. The interactive shell is a separate SSH relay.** `--workspace` is a global flag, defaults to `default`, and reads `OPENSHELL_WORKSPACE`.[^cli-workspace-l467-l476] `openshell term` builds a gateway channel and calls `openshell_tui::run` with that channel, an edge-auth interceptor, and the selected workspace.[^cli-term-l4078-l4096][^tui-run-l89-l100] Switching gateways reads `auth_mode` from local gateway metadata. The OIDC branch loads an access token from the OIDC token store and may also attach mTLS files from the gateway directory. The other branch loads `ca.crt`, `tls.crt`, and `tls.key` from that directory.[^tui-connect-l573-l599][^tui-oidc-mtls-l602-l620][^tui-mtls-files-l641-l654] The TUI screens are splash, a dashboard, and a sandbox view. Dashboard focus panes are gateways, providers, and sandboxes. The sandbox view focuses policy, logs, or a draft.[^tui-screens-l26-l52] An interactive attach resolves the sandbox with `GetSandbox`, then `CreateSshSession`, both scoped to the workspace selector.[^ssh-session-l117-l167] `sandbox_ssh_proxy` opens a TCP forward whose target is the SSH relay, reads stdin on a dedicated thread, and writes relay data frames to stdout.[^ssh-proxy-l1947-l2048] That relay is an operator attachment to a sandbox. It is a different object from a llame Chat or Run. High confidence for the calls that were read. The TUI was not launched.
3. **The guest's processes, shell, and file IO run inside the workload. The outer fence denies direct egress, and the supervisor opens approved connections.** The Linux child path prepares a capability-free Landlock baseline and then the user ruleset.[^prepare-child-l69-l77][^prepare-capability-free-l50-l69] Before exec, `pre_exec` calls `enforce_capability_free`, which applies each prepared Landlock ruleset and then the child seccomp filters.[^pre-exec-l577-l583][^enforce-capability-free-l84-l100] A seccomp filter on the workload is default-allow with targeted blocks: a socket-domain allowlist, unconditional blocks such as ptrace, BPF, and `io_uring`, and conditional blocks such as `execveat` with `AT_EMPTY_PATH`.[^seccomp-header-l4-l17] A user-notification listener's syscall vector starts with `socket`, `connect`, `bind`, and `listen`, and continues through `sendto`, `sendmsg`, `sendmmsg`, `setsockopt`, signal, and `openat` calls. The comment in that function says connected `send()` stays on the audited fast path. `accept` and `accept4` are not in that vector. The broker handles a notified `connect`.[^seccomp-listener-l325-l351][^broker-connect-l588-l589] Docker creates the workload with `network_mode` `none`, `cap_drop` `ALL`, and `no-new-privileges`.[^docker-workload-l6096-l6141] The Docker supervisor container uses bridge or host networking so it can originate approved connections.[^docker-supervisor-net-l5156-l5168] Podman sets the workload network namespace mode to `none`.[^podman-netns-l1638-l1641] The Kubernetes workload `NetworkPolicy` selects ingress and egress and sets egress to an empty list, which the comment describes as allowing no new workload-initiated connection, including DNS and the Kubernetes API.[^k8s-fence-l129-l175] QEMU arguments include `-nic none`. `prepare_network` brings the loopback interface up and returns. The guest init script then sets `ip_unprivileged_port_start` and writes a loopback nameserver. That script was not run.[^qemu-nic-l188-l189][^vm-loopback-l76-l127][^vm-init-script-l658-l672] The runtime table lists Windows MXC as coming soon. This note does not describe that driver.[^runtimes-mxc-l18-l24] Egress evaluation returns deny immediately when a fail-closed reason is already recorded. Otherwise it allows a connection only when the Rego result action is `allow`. Any other action string is a deny, using `deny_reason` when that field is non-empty and otherwise the string `network connections not allowed by policy`.[^egress-deny-l623-l660] The restrictive default policy has an empty network-policy map.[^default-policy-l965-l994] When the gateway snapshot has no policy and `configuration_error` is non-empty, startup calls `reject_startup_configuration` and continues. Otherwise a missing policy uses an image policy if one was discovered and the restrictive default if none was found. An invalid image policy calls `reject_startup_configuration` with a repair message and continues the loop. It does not fall through to the restrictive default.[^policy-discovery-l2630-l2666] High confidence for the fence code that was read. None of it was executed. A future llame Sandbox realization is still capability design, and shipped bash remains host-user authority, including the remote login user for a `machine://` or `ssh://` cwd.[^roadmap-sandbox-l193-l218][^spec-bash-l292-l301]
4. **The capability-free baseline requires Landlock ABI v3. The default user ruleset is `best_effort`.** `prepare_capability_free` builds the baseline first. That baseline calls `require_abi`, which fails unless the probe reports Landlock ABI v3 or newer, and it creates a hard-requirement ruleset that skips the `.openshell` root entry.[^prepare-capability-free-l50-l69][^landlock-require-abi-l70-l87][^landlock-baseline-l131-l210] The restrictive default sets `landlock.compatibility` to `best_effort`, sets `include_workdir`, lists a short read-only set, and lists `/tmp` and `/dev/null` as read-write.[^default-policy-l965-l994] When a workdir is present, `include_workdir` appends that path to the read-write list.[^landlock-workdir-l247-l253] On the optional user ruleset, `best_effort` returns no ruleset when the Landlock probe fails, and a failed `restrict_self` on a `best_effort` ruleset logs that the process is running without filesystem restrictions and returns success. `hard_requirement` returns the error.[^best-effort-unavailable-l260-l289][^best-effort-enforce-l410-l448] Because the child path prepares the hard baseline before the user ruleset, a missing Landlock ABI fails in `require_abi` before that user-ruleset branch runs. A `best_effort` `restrict_self` failure can still return success after the baseline ruleset has already been enforced. This note did not execute either order, so it does not report which message a host prints. The borrow for the unshipped Sandbox direction is the hard baseline that fails closed, kept separate from an optional policy whose compatibility mode can continue. VISION's rule that sandbox failure never silently downgrades to native execution is the llame constraint those modes would have to meet.[^vision-sandbox-l186-l206]
5. **Approval gates a policy change. It is not a per-command prompt.** The finding-type comment describes four categories: credentialed reach to a host and port the binary could not reach before, a new HTTP method on reach that already existed, an uninspectable protocol the comment names as `git-remote-https`, `ssh`, or `nc` toward a host where a credential is in scope, and any reach to link-local ranges. That comment lists `169.254.0.0/16` and `fe80::/10`. The query also treats `metadata.google.internal` as that category. The comment says an empty delta is the auto-approval candidate and any finding waits for a person.[^prover-findings-l4-l24][^link-local-host-l58-l66] The query used for one model records both a credential-reach path and a capability path, and its comment says the gateway delta keeps the relevant category.[^prover-both-l144-l181] `finding_delta` drops paths already present in the baseline and suppresses capability paths whose binary, host, and port are in the new reach delta.[^finding-delta-l1065-l1129] `auto_approve_chunk` returns before mutation when a global policy is active, skips chunks that are not `pending`, and skips when the live validation result is not the string `prover: no new findings` or when security notes are non-empty.[^auto-approve-l1803-l1867] A supplied review token that differs from the stored token, or a live evaluation whose token changed, is `failed_precondition` and tells the caller to refetch.[^review-token-l1753-l1792] llame ships operator allow/reject permissions and a per-Run `default | bypass` mode. An interactive approval workflow does not ship.[^spec-approval-l77] An OpenShell prover result is a policy-merge decision inside the gateway. It is not llame authorization. Identity and approvals stay out of prompts.[^vision-execution-l78-l88] High confidence for the gate that was read. No proposal was submitted.
6. **Gateway workspace is an access boundary. The guest working directory is an image path.** The CLI workspace flag selects that boundary and defaults to `default`.[^cli-workspace-l467-l476] `is_platform_admin` returns true when `admin_role` is empty, and the server comment says that field is empty when OIDC is not configured, so the user-principal branch of `authorize_workspace` grants platform admin.[^platform-admin-l253-l262][^admin-role-comment-l370-l372][^authorize-match-l144-l216] A sandbox principal receives a sandbox grant. A peer principal is denied.[^authorize-match-l144-l216] A unit test with an empty admin role and a user principal that has no roles expects a platform-admin grant.[^admin-role-test-l593-l599] That is application RBAC. It is not llame's owner RLS. The container workspace root defaults to `/sandbox`. An OCI `WorkingDir` that is empty or `/` resolves to that same path. Any other value must already be a normalized absolute container path.[^workspace-root-l30-l32][^oci-workdir-l101-l111] Docker resolves the image working directory, writes that string to the boundary `workspace-root` file, reads the file back, and passes that string to the supervisor as `--workdir`.[^docker-resolve-workdir-l4626-l4627][^docker-write-workdir-l4723-l4726][^docker-read-workdir-l5243-l5245][^docker-workdir-arg-l5326-l5332] The workload container's own `working_dir` is `/`, so the OCI runtime does not chdir into the image workspace before the sandbox binary starts.[^docker-workload-l6096-l6141] The parent command removes supervisor-only variables, including the sandbox token and TLS key, injects provider environment entries that are not supervisor-only names, and sets the child current directory to the workspace root when one is present.[^supervisor-env-l111-l123][^inject-provider-l169-l175][^child-cwd-l510-l527] The operator's host cwd is not the guest cwd. llame's entered Workspace is an owner-scoped executor binding, and the CLI start-directory grant in the roadmap is unselected backlog for native execution in the directory where the CLI was started.[^spec-boundary-l35][^roadmap-cli-l171-l191] High confidence for the path resolution and the env strip that were read. A container was not started.
7. **Provider attachment places a credential. The inference page says the workload controls the model.** The workload receives provider environment entries that are not supervisor-only names.[^inject-provider-l169-l175][^child-cwd-l510-l527] The inference page says provider attachment does not select or rewrite a model, and that the workload controls model selection.[^inference-model-l94-l95][^inference-workload-l311-l316] On an inspected request, the allow path runs the middleware chain and then `forward_inspected_request`. An audit-mode deny that is not `force_deny` uses that same arm.[^middleware-then-forward-l1426-l1537] Forwarding prepares a token grant when a pinned credential has `token_grant`, then relays the request with a secret resolver.[^prepare-grant-l175-l183][^forward-credentials-l681-l740] The token-grant module comment describes the path used when a provider profile includes `token_grant`: the proxy intercepts an outbound request to a provider endpoint, and the last step injects `Authorization: Bearer`.[^token-grant-l5-l18] Placeholders use the `openshell:resolve:env:*` form. If TLS termination state is missing and the route is not `tls: skip`, CONNECT is refused with HTTP 503 before `200 Connection Established`, so the placeholder is not raw-tunneled.[^tls-refuse-l7021-l7059] `reject_body_credential` writes HTTP 403 for a `BodyCredentialError`, and that body says credential rewriting is disabled.[^body-placeholder-l628-l640][^proxy-body-403-l6715-l6724] That is one path. `request_body_credential_rewrite` defaults to false. When it is set, the REST relay rewrites a textual body and writes it upstream. `websocket_credential_rewrite` is a separate opt-in and also defaults to false.[^schema-body-flags-l288-l299][^rest-body-rewrite-l1200-l1215] When rewrite is off, `deny_uninspected_body_credentials` is false if `allow_uninspected_credentials` is set, and that remaining branch writes the rewritten header block upstream and then relays the remaining body, without the marker guard.[^deny-uninspected-l463-l465][^rest-forward-body-l1232-l1248] MCP here is an inspected egress protocol. `is_mcp_protocol` matches the policy name `mcp`. The supervisor selects a Streamable HTTP revision, checks request metadata, and can reject an invalid MCP request with HTTP 400 before forward. The authored allowlist is `2025-03-26`, `2025-06-18`, `2025-11-25`, and `2026-07-28`, and an omitted version list materializes `2025-11-25`.[^mcp-protocol-l14-l20][^mcp-module-l1-l16][^mcp-reject-l330-l367][^mcp-versions-l25-l43] The public `skills/` directory teaches another coding agent to drive the OpenShell CLI, write sandbox policies, and debug gateways and inference routing. Those skills are not an in-process plugin host.[^readme-l52-l60] Extension points that were read are the compute driver, supervisor middleware on the allow path, and the isolation backend behind `prepare_capability_free`. A full plugin catalog was not inventoried. llame's provider and model configuration stays the one in SPEC. This note does not move model selection into a sandbox proxy. High confidence for the rewrite and rejection paths that were read. No credential was issued.
8. **The license is Apache-2.0.** The `LICENSE` file is the Apache License, Version 2.0, copyright 2026 NVIDIA Corporation and affiliates. The workspace `Cargo.toml` sets `license` to `Apache-2.0`.[^license-l1-l5][^cargo-l12]

**Caution**

The architecture page says the agent shares the sandbox side of the boundary and holds no provider credentials.[^architecture-agent-l176-l179] The parent strips supervisor-only environment before the child runs, and the proxy paths that were read keep upstream credential injection on the supervisor.[^child-cwd-l510-l527][^forward-credentials-l681-l740] A `best_effort` user ruleset can record success after `restrict_self` fails, while the capability-free baseline remains a hard ABI check.[^best-effort-enforce-l410-l448][^landlock-require-abi-l70-l87] An empty OIDC admin role makes every authenticated user principal a platform admin. A sandbox principal does not get that grant.[^platform-admin-l253-l262][^authorize-match-l144-l216] Workspace membership is application RBAC. It does not provide llame's authenticated ownership or datastore RLS. The same-process resume sentence on the architecture page was not confirmed in `commit_confirm`.[^architecture-same-process-l181-l183][^confirm-resume-l2211-l2226] Nothing in this note was executed. llame's approval, Workspace, and bash contracts remain the ones in SPEC, VISION, and ROADMAP.[^spec-boundary-l35][^spec-approval-l77][^spec-bash-l292-l301][^vision-sandbox-l186-l206][^roadmap-sandbox-l193-l218]

[^readme-l19]: [OpenShell is a runtime that enforces a declared policy around agent capabilities](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/README.md#L19)

[^readme-how-l23-l27]: [README: kernel enforcement and a formal check before a policy change](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/README.md#L23-L27)

[^readme-l39]: [The default sandbox image ships no agent](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/README.md#L39)

[^readme-l14]: [README badge points at the live docs site](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/README.md#L14)

[^readme-l52-l60]: [Public skills teach another agent to drive the CLI, write policy, and debug gateways](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/README.md#L52-L60)

[^license-l1-l5]: [Apache License 2.0 heading](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/LICENSE#L1-L5)

[^cargo-l12]: [Workspace package license is Apache-2.0](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/Cargo.toml#L12)

[^cargo-tonic-l22]: [Workspace depends on tonic](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/Cargo.toml#L22)

[^tags-listing]: [Unpinned tags listing; v0.1.5 was not diffed against this commit](https://github.com/NVIDIA/OpenShell/tags)

[^cli-workspace-l467-l476]: [Global workspace flag defaults to default](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-cli/src/main.rs#L467-L476)

[^tui-screens-l26-l52]: [TUI screens and focus panes: gateways, providers, sandboxes, policy, and logs](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-tui/src/app.rs#L26-L52)

[^tui-run-l89-l100]: [TUI run takes a connected gateway channel and a workspace](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-tui/src/lib.rs#L89-L100)

[^cli-term-l4078-l4096]: [openshell term builds a gRPC channel and launches the TUI](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-cli/src/main.rs#L4078-L4096)

[^tui-connect-l573-l599]: [Gateway switch reads auth_mode and loads an OIDC token or an mTLS channel](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-tui/src/lib.rs#L573-L599)

[^tui-oidc-mtls-l602-l620]: [The OIDC channel may also attach mTLS files from the gateway directory](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-tui/src/lib.rs#L602-L620)

[^tui-mtls-files-l641-l654]: [The mTLS branch reads ca.crt, tls.crt, and tls.key](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-tui/src/lib.rs#L641-L654)

[^ssh-session-l117-l167]: [SSH attach creates a gateway session over gRPC](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-cli/src/ssh.rs#L117-L167)

[^ssh-proxy-l1947-l2048]: [ssh-proxy opens an SSH-relay TCP forward and copies stdin and stdout](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-cli/src/ssh.rs#L1947-L2048)

[^grpc-client-l2057-l2062]: [The supervisor opens the gateway channel](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-core/src/grpc_client.rs#L2057-L2062)

[^docker-workload-l6096-l6141]: [Docker workload drops all capabilities and uses network none](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-docker/src/lib.rs#L6096-L6141)

[^docker-supervisor-net-l5156-l5168]: [The Docker supervisor uses bridge or host networking](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-docker/src/lib.rs#L5156-L5168)

[^podman-netns-l1638-l1641]: [Podman workload network namespace mode is none](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-podman/src/container.rs#L1638-L1641)

[^k8s-fence-l129-l175]: [Kubernetes workload NetworkPolicy has an empty egress list](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-kubernetes/src/isolation.rs#L129-L175)

[^qemu-nic-l188-l189]: [QEMU launch args pass -nic none](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-vm/src/runtime.rs#L188-L189)

[^vm-loopback-l76-l127]: [prepare_network brings loopback up and returns](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-vm/src/bin/openshell-vm-init.rs#L76-L127)

[^vm-init-script-l658-l672]: [Guest init script sets the unprivileged port start and writes nameserver 127.0.0.53](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-vm/scripts/openshell-vm-sandbox-init.sh#L658-L672)

[^runtimes-mxc-l18-l24]: [Runtime table marks Windows MXC coming soon](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/docs/how-it-works/sandboxes/runtimes.mdx#L18-L24)

[^prepare-capability-free-l50-l69]: [Capability-free prepare installs a hard baseline, then the user ruleset](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/mod.rs#L50-L69)

[^enforce-capability-free-l84-l100]: [enforce_capability_free applies each Landlock ruleset, then child seccomp](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/mod.rs#L84-L100)

[^pre-exec-l577-l583]: [pre_exec calls enforce_capability_free before exec](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/process.rs#L577-L583)

[^prepare-child-l69-l77]: [The child sandbox uses the capability-free prepare path](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/process.rs#L69-L77)

[^landlock-require-abi-l70-l87]: [The mandatory baseline requires Landlock ABI v3 or newer](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/landlock.rs#L70-L87)

[^landlock-baseline-l131-l210]: [Capability-free baseline is a hard-requirement ruleset and skips .openshell](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/landlock.rs#L131-L210)

[^landlock-workdir-l247-l253]: [include_workdir appends the working directory to the read-write list](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/landlock.rs#L247-L253)

[^best-effort-unavailable-l260-l289]: [A best-effort user ruleset is omitted when Landlock is unavailable](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/landlock.rs#L260-L289)

[^best-effort-enforce-l410-l448]: [best_effort restrict_self failure logs and returns success](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/landlock.rs#L410-L448)

[^seccomp-header-l4-l17]: [Workload seccomp is default-allow with targeted blocks](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/sandbox/linux/seccomp.rs#L4-L17)

[^seccomp-listener-l325-l351]: [Workload listener syscall vector starts with socket, connect, bind, and listen](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/linux/seccomp_notify.rs#L325-L351)

[^broker-connect-l588-l589]: [A notified connect is handled by the network broker](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/network_broker.rs#L588-L589)

[^freeze-l2249-l2347]: [A lost Sandbox Protocol connection freezes the workload, then terminates it after the recovery deadline](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/boundary_server.rs#L2249-L2347)

[^reconnect-timeout-l89]: [Authenticated reconnect timeout is 30 seconds](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/boundary_server.rs#L89)

[^confirm-resume-l2211-l2226]: [A successful confirm resumes a frozen workload](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/boundary_server.rs#L2211-L2226)

[^architecture-agent-l176-l179]: [Architecture page: the agent shares the sandbox side and holds no provider credentials](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/docs/about/architecture.mdx#L176-L179)

[^architecture-same-process-l181-l183]: [Architecture page says only the same supervisor process can resume](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/docs/about/architecture.mdx#L181-L183)

[^default-policy-l965-l994]: [Restrictive default includes the workdir, best-effort Landlock, and no network rules](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-policy/src/lib.rs#L965-L994)

[^policy-discovery-l2630-l2666]: [A configuration error retries; otherwise a missing policy uses image discovery or the restrictive default](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor/src/lib.rs#L2630-L2666)

[^egress-deny-l623-l660]: [A recorded fail-closed reason denies egress; otherwise only action allow is allowed](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/opa.rs#L623-L660)

[^prover-findings-l4-l24]: [Prover findings are categorical and any finding blocks auto-approval](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-prover/src/finding.rs#L4-L24)

[^link-local-host-l58-l66]: [Link-local findings also match metadata.google.internal](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-prover/src/queries.rs#L58-L66)

[^prover-both-l144-l181]: [One model records both credential-reach and capability paths; the gateway delta keeps the category](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-prover/src/queries.rs#L144-L181)

[^finding-delta-l1065-l1129]: [finding_delta drops baseline paths and suppresses capability paths covered by new reach](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/grpc/policy.rs#L1065-L1129)

[^auto-approve-l1803-l1867]: [Auto-approval requires no global policy, the prover string no new findings, and empty security notes](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/grpc/policy.rs#L1803-L1867)

[^review-token-l1753-l1792]: [A stale review token fails closed and asks for a refetch](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/grpc/policy.rs#L1753-L1792)

[^platform-admin-l253-l262]: [An empty admin role makes is_platform_admin return true](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/auth/workspace_authz.rs#L253-L262)

[^authorize-match-l144-l216]: [User principals with an empty admin role get platform admin; sandbox principals do not](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/auth/workspace_authz.rs#L144-L216)

[^admin-role-comment-l370-l372]: [admin_role is empty when OIDC is not configured](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/lib.rs#L370-L372)

[^admin-role-test-l593-l599]: [Test: empty admin role authorizes a user with no roles as platform admin](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-server/src/auth/workspace_authz.rs#L593-L599)

[^workspace-root-l30-l32]: [Default container workspace root is /sandbox](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-core/src/driver_mounts.rs#L30-L32)

[^oci-workdir-l101-l111]: [Empty OCI WorkingDir and / fall back to /sandbox](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-core/src/driver_mounts.rs#L101-L111)

[^docker-resolve-workdir-l4626-l4627]: [Docker resolves the OCI working directory before writing boundary state](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-docker/src/lib.rs#L4626-L4627)

[^docker-write-workdir-l4723-l4726]: [Docker writes the resolved workspace root to the workspace-root file](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-docker/src/lib.rs#L4723-L4726)

[^docker-read-workdir-l5243-l5245]: [Docker reads the workspace-root file before building the supervisor command](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-docker/src/lib.rs#L5243-L5245)

[^docker-workdir-arg-l5326-l5332]: [Docker passes that workspace-root string to the supervisor as --workdir](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-driver-docker/src/lib.rs#L5326-L5332)

[^inject-provider-l169-l175]: [Provider env injection skips supervisor-only keys](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/process.rs#L169-L175)

[^child-cwd-l510-l527]: [The parent command drops supervisor-only env, injects provider env, and sets the child cwd](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/process.rs#L510-L527)

[^supervisor-env-l111-l123]: [Supervisor-only env includes the sandbox token and TLS key](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-sandbox/src/process.rs#L111-L123)

[^tls-refuse-l7021-l7059]: [Missing TLS termination refuses CONNECT with HTTP 503 unless tls skip is set](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/proxy.rs#L7021-L7059)

[^body-placeholder-l628-l640]: [BodyCredentialError response is HTTP 403 and says body rewriting is disabled](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/relay.rs#L628-L640)

[^proxy-body-403-l6715-l6724]: [A BodyCredentialError from the relay is written as that 403](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/proxy.rs#L6715-L6724)

[^schema-body-flags-l288-l299]: [REST and WebSocket body credential rewrite default to false](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-policy-schema/src/lib.rs#L288-L299)

[^rest-body-rewrite-l1200-l1215]: [request_body_credential_rewrite rewrites a REST body and writes it upstream](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/rest.rs#L1200-L1215)

[^deny-uninspected-l463-l465]: [deny_uninspected_body_credentials is false when allow_uninspected_credentials is set](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/mod.rs#L463-L465)

[^rest-forward-body-l1232-l1248]: [The remaining REST branch writes rewritten headers and relays the remaining body](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/rest.rs#L1232-L1248)

[^middleware-then-forward-l1426-l1537]: [An allowed L7 request runs middleware before forward_inspected_request](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/relay.rs#L1426-L1537)

[^prepare-grant-l175-l183]: [Token-grant injection runs only when a pinned credential has token_grant](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/relay.rs#L175-L183)

[^forward-credentials-l681-l740]: [Forwarding prepares a token grant, then relays with a secret resolver](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/relay.rs#L681-L740)

[^token-grant-l5-l18]: [Token grant, when configured, intercepts a provider request and injects Authorization](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/token_grant.rs#L5-L18)

[^mcp-versions-l25-l43]: [Authored MCP revisions are a closed set; the default is 2025-11-25](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-policy-schema/src/lib.rs#L25-L43)

[^mcp-protocol-l14-l20]: [is_mcp_protocol matches the policy name mcp](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-core/src/mcp.rs#L14-L20)

[^mcp-module-l1-l16]: [MCP module selects a Streamable HTTP revision and validates request metadata](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/mcp.rs#L1-L16)

[^mcp-reject-l330-l367]: [An invalid MCP request is HTTP 400 and returns before forward](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/crates/openshell-supervisor-network/src/l7/relay.rs#L330-L367)

[^inference-model-l94-l95]: [Provider attachment does not select or rewrite a model](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/docs/how-it-works/inference.mdx#L94-L95)

[^inference-workload-l311-l316]: [The workload controls model selection after provider attachment](https://github.com/NVIDIA/OpenShell/blob/07b7a74b62a42b9ab1dcc14cb224731108978dd9/docs/how-it-works/inference.mdx#L311-L316)

[^vision-execution-l78-l88]: [The harness owns execution; credentials and approvals stay out of prompts](https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/VISION.md#L78-L88)

[^vision-sandbox-l186-l206]: [Surface, Node, Workspace, and Sandbox stay separate; sandbox failure never silently downgrades](https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/VISION.md#L186-L206)

[^spec-boundary-l35]: [Sandbox is not a current runtime object; an entered Workspace is an executor binding](https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/SPEC.md#L35)

[^spec-approval-l77]: [Operator permissions ship; interactive approval does not](https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/SPEC.md#L77)

[^spec-exec-l108-l110]: [Execution is pg-boss plus RunExecutionService; remote Machines move tool execution only](https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/SPEC.md#L108-L110)

[^spec-bash-l292-l301]: [Shipped bash is host-user authority; a managed Sandbox adapter is future](https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/SPEC.md#L292-L301)

[^roadmap-cli-l171-l191]: [Standalone personal Node and CLI remain unselected backlog](https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/ROADMAP.md#L171-L191)

[^roadmap-sandbox-l193-l218]: [Local Sandbox execution is sequenced after the Node runtime and remains capability design](https://github.com/leon0399/llame/blob/683ce1944e0454ff3c251d1139fc9ab64164b87e/ROADMAP.md#L193-L218)
