---
type: Research
title: "Remote provisioning of Machines"
description: "Compares operator-supplied Terraform modules and direct cloud APIs for remote Machine provisioning, including credentials, cost and quota controls, latency, and uncertain teardown."
tags: [machines, provisioning, terraform, cloud, cost-controls]
status: draft
summary: "Compares Terraform-module and direct-API provisioning for remote Machines, including credentials, cost and quota controls, startup latency, and recovery from uncertain teardown."
read_when:
  - choosing how llame creates and destroys remote Machines
  - deciding where cloud credentials and provisioning authority should live
observed:
  date: "2026-11-18"
sources:
  - id: devpod-machines
    resource: "https://devpod.sh/docs/how-it-works/deploy-machines"
    title: "DevPod machine providers create cloud VMs using local credentials and provider CLIs"
  - id: devpod-provider
    resource: "https://devpod.sh/docs/developing-providers/quickstart"
    title: "DevPod provider manifest lifecycle and machine status interface"
  - id: devpod-delete
    resource: "https://devpod.sh/docs/developing-in-workspaces/delete-a-workspace"
    title: "DevPod force deletion removes local tracking but can leave cloud resources"
  - id: devpod-inactivity
    resource: "https://devpod.sh/docs/developing-in-workspaces/inactivity-timeout"
    title: "DevPod provider inactivity shutdown and configured 5-10 minute defaults"
  - id: coder-auth
    resource: "https://coder.com/docs/admin/templates/extending-templates/provider-authentication"
    title: "Coder recommends authenticated provisioner environments over template-stored secrets"
  - id: coder-provisioners
    resource: "https://coder.com/docs/install/operate/provisioners"
    title: "Coder external provisioners isolate credentials and execute Terraform builds"
  - id: coder-schedule
    resource: "https://coder.com/docs/admin/templates/managing-templates/schedule"
    title: "Coder workspace autostop, dormancy, deletion, and failure cleanup"
  - id: terraform-lifecycle
    resource: "https://developer.hashicorp.com/terraform/cli/run"
    title: "Terraform create, reconcile, and destroy lifecycle uses state"
  - id: ec2-runinstances
    resource: "https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_RunInstances.html"
    title: "EC2 RunInstances idempotency, launch tagging, and ready state"
  - id: ec2-throttling
    resource: "https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-throttling.html"
    title: "EC2 account-Region API and resource throttling, quotas, retries"
  - id: ec2-quotas
    resource: "https://docs.aws.amazon.com/AWSEC2/latest/instancetypes/ec2-instance-quotas.html"
    title: "EC2 instance-family vCPU quotas"
  - id: ec2-tags
    resource: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html"
    title: "EC2 resource tags support search, filtering, and billing allocation"
  - id: aws-budget-actions
    resource: "https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html"
    title: "AWS Budgets can deny further provisioning or target EC2 instances"
  - id: ec2-faq
    resource: "https://aws.amazon.com/ec2/faqs/"
    title: "AWS describes EC2 instance acquisition and boot as taking minutes"
---

# Remote provisioning of Machines

## Summary

**Finding (moderate confidence):** for initial remote Machines, llame should prefer a pinned, operator-supplied Terraform module executed by an isolated provisioning worker, while keeping the Machine daemon's lifecycle contract independent of Terraform. This fits the requested operator-owned recipe and lets infrastructure owners expose a deliberately narrow set of approved parameters. Direct provider APIs are simpler for a single cloud and can make allocation identity/idempotency explicit, but llame would own resource modeling, provider-specific cleanup, and drift handling for every supported cloud. This recommendation is an inference from the comparisons below, not a tested llame implementation.

Terraform is not inherently safer: templates/modules are executable infrastructure code, so the executor must be isolated and cloud credentials scoped. Coder explicitly separates external provisioners to isolate APIs and secrets; DevPod instead calls provider commands using the user's local credentials. [^coder-provisioners][^devpod-machines]

## Decision comparison

|                           | Operator-supplied Terraform module                                                                                                                                                                                                                               | Direct cloud API (for example EC2 `RunInstances`)                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract                  | Operator provides a pinned module/template and input contract; Terraform plans/applies/destroys declared infrastructure using stored state. [^terraform-lifecycle]                                                                                               | llame defines provider-specific create, inspect, stop, and terminate operations itself. EC2's API accepts a `ClientToken` for idempotency, tags at launch, and reports ready when the instance reaches `running`. [^ec2-runinstances]                                                            |
| Control and extensibility | Operators can encode their VPC, IAM, storage, and policy choices, but can also supply powerful executable configuration. External build workers can isolate credentials and cloud APIs from the control plane. [^coder-provisioners]                             | Narrower llame-owned input schema can enforce defaults, resource bounds, and provider APIs directly; this is an architectural inference. Every provider still needs its own lifecycle and drift/recovery handling.                                                                               |
| State / uncertain create  | Terraform state maps declared resources to real infrastructure and is required to plan and destroy managed objects. If remote state is lost or apply is interrupted, a state-less destroy cannot be assumed to find every created object. [^terraform-lifecycle] | Durable operation ID plus provider idempotency token can safely repeat a supported create request; on EC2, `ClientToken` ensures request idempotency. [^ec2-runinstances]                                                                                                                        |
| Prior art                 | Coder workspace templates are Terraform builds; Coder recommends credentials in the authenticated provisioner environment, not in templates. [^coder-auth][^coder-provisioners]                                                                                  | DevPod's provider interface is command-oriented (`create`, `delete`, `start`, `stop`, `status`); its AWS VM provider uses local user credentials and corresponding CLI. This supports a provider adapter pattern, but not a central multi-cloud API design. [^devpod-provider][^devpod-machines] |

These options are not mutually exclusive at the whole product level: a Terraform provider may call direct cloud APIs, and a built-in direct-API provisioner can coexist with an operator module for custom topologies. Prefer one owner for a particular provision operation and avoid falling back between mechanisms after an ambiguous create. [Inference]

## Credentials and trust boundary

- **Terraform module:** credentials must be present where Terraform executes. Coder's preferred pattern is an authenticated environment using standard locations such as `~/.aws/credentials` or environment variables; it cautions against secrets in templates because template users can read them. External provisioners can keep cloud secrets out of the control-plane database and rotate them locally. [^coder-auth][^coder-provisioners]
- **Direct API:** the daemon/provisioning worker needs provider API credentials. For EC2, the launch request can also attach an IAM instance profile to the guest. Keep provisioning authority distinct from the guest role; the guest role is a resource attached to the instance, not a credential substitute for calling the launch API. [^ec2-runinstances]
- **DevPod precedent:** the provider CLI uses credentials from the local environment that starts the workspace and connects through a provider tunnel. This puts cloud authority on the caller's machine rather than in the remote guest. [^devpod-machines]
- **Synthesis, moderate confidence:** store renewable, least-privilege cloud credentials in the isolated provisioner environment (local operator host for local provisioning; a dedicated remote worker/instance identity for cloud-hosted provisioning); do not put cloud credentials in `devcontainer.json`, guest user data, or model-visible template parameters. The cited systems support the boundary, but exact IAM policy design is provider-specific. [Inference]

## Cost controls, quotas, and latency

**Cost controls.** DevPod documents inactivity shutdown for machine providers and says its official providers typically default to 5-10 minutes; they may stop a VM or delete/recreate it depending on provider economics. [^devpod-inactivity] Coder offers template defaults for autostop and dormancy/deletion, while noting failure cleanup and dormancy features are plan-gated. [^coder-schedule] AWS Budgets can trigger a deny policy preventing new EC2 provisioning, or target EC2 instances; budget alerts/actions are not a per-instance TTL guarantee. [^aws-budget-actions]

For EC2, tag resources at create time with an opaque provision-operation/lease ID, owner, created-at, and expiry. Tags make resources searchable and usable for cost allocation, but AWS gives tags no semantic force; cleanup must enumerate candidates and explicitly terminate their IDs. [^ec2-runinstances][^ec2-tags] Enforce a hard lease TTL and resource caps in llame's control plane rather than relying only on provider inactivity heuristics. [Inference]

**Quotas.** EC2 quotas include per-Region, instance-family vCPU limits. Separately, API throttling is account/Region scoped: `RunInstances` uses a resource token bucket (documented default capacity 1,000, refill 2 instances/second) as well as request throttling; `TerminateInstances` also has resource throttling. These are launch-rate limits, not the account's allowed concurrent capacity. [^ec2-quotas][^ec2-throttling] The EC2 API docs require `MaxCount` / `MinCount` to fit the applicable instance-type quota. [^ec2-runinstances] Admission should reserve capacity against llame's own concurrent resource budget and treat provider quota/throttle responses as distinct rejection causes. [Inference]

**Boot time.** AWS's public FAQ says EC2 reduces acquisition and boot to **minutes**, not a fixed SLA. DevPod's 5-10 minute figure is an inactivity timeout, not boot time. The sources reviewed do not establish a reliable end-to-end distribution from create request to a ready daemon; measure that per recipe/region and report a range only after live telemetry exists. [^ec2-faq][^devpod-inactivity] **Confidence: high** for AWS's broad minutes-level claim; low for any narrower estimate.

## Teardown uncertainty and leaked-resource recovery

DevPod explicitly warns that force-deleting a workspace after provider deletion fails removes only DevPod's local record and can leave previously created resources behind. [^devpod-delete] Coder's scheduling has failure cleanup for workspaces that remain in a failed state, in addition to autostop and dormancy deletion; this is useful lifecycle policy but does not establish that arbitrary cloud resources with missing state are discovered. [^coder-schedule] AWS tags aid discovery, but tags alone do not delete resources. [^ec2-tags]

llame should therefore preserve a durable provision-operation record and enter an **unknown / cleanup-pending** state whenever provider teardown is unconfirmed; do not treat timeout, unreachable worker, or local record removal as proof of deletion. This matches the prior llame placement research's established teardown-unknown position; see [multi-device execution placement §4.6](2026-10-18-multi-device-execution-placement.md#46-ephemeral-sandboxes) and the linked [OpenClaw sandbox and cloud-worker study](2026-09-27-openclaw-sandboxes-and-cloud-workers.md) for previously covered lease semantics. [^terraform-lifecycle]

**Recommended reconciliation (moderate confidence; synthesis):**

1. Generate a unique durable operation ID before provisioning and use it as the API idempotency token where supported; write that ID and expiry tag atomically at resource creation. [^ec2-runinstances]
2. Retain the operation's provider resource identifiers and Terraform state reference even after a workspace is marked unavailable. Retry destroy/terminate against the exact IDs; only clear the record after provider confirmation. [^terraform-lifecycle]
3. Periodically enumerate provider resources carrying llame's management and operation tags, compare them to active durable operation records, and quarantine/alert on unmatched or expired resources before policy-driven cleanup. AWS tags support querying and billing attribution but are mutable labels, not authoritative proof of ownership. [^ec2-tags] [Inference]
4. Set TTL expiry at provision time and use a reconciler as a second cleanup path, not just a guest-side agent: the guest may be offline or compromised. Stop or terminate only resources whose ownership is positively attributed to llame; preserve ambiguous resources for operator review. [Inference]
5. Make “forget local record” an explicit data-loss/cost-risk operation, not ordinary teardown. DevPod's documented force-delete warning shows why local bookkeeping and provider deletion must not be conflated. [^devpod-delete]

## Limits and evidence

This is a comparison of public vendor documentation, not a benchmark or a review of cloud bills. No live AWS account was provisioned, so no actual quota values, regional availability, per-instance cost, or end-to-end startup percentile is asserted. Quotas are account-specific; budgets and cost allocation also have reporting delays and are not immediate hard spend ceilings. The report follows the prior llame findings for sandbox placement and does not re-argue them.

[^devpod-machines]: [DevPod: How it works using VMs](https://devpod.sh/docs/how-it-works/deploy-machines).

[^devpod-provider]: [DevPod provider quickstart](https://devpod.sh/docs/developing-providers/quickstart).

[^devpod-delete]: [DevPod: Delete a Workspace](https://devpod.sh/docs/developing-in-workspaces/delete-a-workspace).

[^devpod-inactivity]: [DevPod: Auto-Inactivity Timeout](https://devpod.sh/docs/developing-in-workspaces/inactivity-timeout).

[^coder-auth]: [Coder: Provider authentication](https://coder.com/docs/admin/templates/extending-templates/provider-authentication).

[^coder-provisioners]: [Coder: External provisioners](https://coder.com/docs/install/operate/provisioners).

[^coder-schedule]: [Coder: Workspace scheduling](https://coder.com/docs/admin/templates/managing-templates/schedule).

[^terraform-lifecycle]: [Terraform workflow for provisioning infrastructure](https://developer.hashicorp.com/terraform/cli/run).

[^ec2-runinstances]: [Amazon EC2 API: RunInstances](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_RunInstances.html).

[^ec2-throttling]: [Amazon EC2 API throttling](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-throttling.html).

[^ec2-quotas]: [Amazon EC2 instance type quotas](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html).

[^ec2-tags]: [Tag your Amazon EC2 resources](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html).

[^aws-budget-actions]: [Configuring AWS Budgets actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html).

[^ec2-faq]: [Amazon EC2 FAQs](https://aws.amazon.com/ec2/faqs/).
