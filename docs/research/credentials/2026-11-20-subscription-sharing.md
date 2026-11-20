---
type: Research
title: "Subscription credentials across several Owners"
description: "Reads OpenAI and Anthropic terms, help articles and Codex auth documentation on whether one subscription login may serve Runs for several Owners of one installation, and states what llame must enforce."
tags: [credentials, subscriptions, terms, openai, anthropic, multi-tenant]
status: draft
summary: "One ChatGPT or Claude subscription login may not serve several Owners. OpenAI binds an account to one individual, Anthropic binds plan OAuth to subscribers and forbids routing on behalf of users, so a shared installation credential must be limited to its subscriber's own Chats."
read_when:
  - deciding whether an installation-scope subscription Credential may serve several Owners
  - designing owner-scope subscription credentials for ChatGPT/Codex or Claude
  - explaining an auth failure on a subscription provider to an Owner who is not the subscriber
observed:
  date: "2026-11-20"
sources:
  - id: openai-tou-row
    resource: "https://openai.com/policies/row-terms-of-use/"
    title: "OpenAI Terms of Use, effective 2026-01-01, for individuals outside the EEA, Switzerland and UK"
  - id: openai-tou-eu
    resource: "https://openai.com/policies/eu-terms-of-use/"
    title: "OpenAI Europe Terms of Use, updated 2026-01-16"
  - id: openai-account-sharing
    resource: "https://help.openai.com/en/articles/10471989-openai-account-sharing-policy"
    title: "OpenAI Account Sharing Policy help article"
  - id: openai-services-agreement
    resource: "https://openai.com/policies/services-agreement/"
    title: "OpenAI Services Agreement, effective 2026-01-01, for APIs, ChatGPT Enterprise and ChatGPT Business"
  - id: codex-auth
    resource: "https://learn.chatgpt.com/docs/auth"
    title: "Codex authentication documentation"
  - id: codex-ci-cd-auth
    resource: "https://learn.chatgpt.com/docs/auth/ci-cd-auth"
    title: "Maintain Codex account auth in CI/CD (advanced)"
  - id: codex-app-server
    resource: "https://learn.chatgpt.com/docs/app-server"
    title: "Codex App Server documentation"
  - id: codex-pricing
    resource: "https://learn.chatgpt.com/docs/pricing"
    title: "Codex pricing, plans and included usage"
  - id: anthropic-consumer-terms
    resource: "https://www.anthropic.com/legal/consumer-terms"
    title: "Anthropic Consumer Terms of Service, effective 2025-10-08"
  - id: anthropic-commercial-terms
    resource: "https://www.anthropic.com/legal/commercial-terms"
    title: "Anthropic Commercial Terms of Service, effective 2025-06-17"
  - id: claude-legal
    resource: "https://code.claude.com/docs/en/legal-and-compliance"
    title: "Claude Code legal and compliance, sections on authentication and credential use"
  - id: claude-login
    resource: "https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account"
    title: "Log in to your Claude account help article"
  - id: claude-team-seats
    resource: "https://support.claude.com/en/articles/12004354-purchase-and-manage-seats-on-team-plans"
    title: "Purchase and manage seats on Team plans"
  - id: llame-codex-provider
    resource: "../../product/operator/providers/codex-subscription.md"
    title: "llame Codex subscription provider page"
  - id: llame-available-models
    resource: "../../../openspec/specs/available-models/spec.md"
    title: "llame available-models specification"
  - id: llame-glossary
    resource: "../../product/glossary.md"
    title: "llame product glossary"
---

# Subscription credentials across several Owners

## Summary

One ChatGPT or Claude subscription login may not serve Runs for several Owners
of one installation. OpenAI binds an account to the individual who created it.
Anthropic binds plan OAuth to subscribers and forbids routing requests through
plan credentials on behalf of users. [^openai-tou-row][^openai-account-sharing][^claude-legal][^claude-login]

A household and a team fail the same way. Neither provider offers a shared
consumer account, and neither document carves out a household. OpenAI's
Business and Enterprise terms allow one End User per End User Account.
Anthropic Team seats belong to one named individual, and the seat article
forbids routing work through another user's account.
[^openai-services-agreement][^claude-team-seats]

llame shares today. The `openai-codex` provider is installation scope and reads
the operator's `auth.json`. Every Owner can select a `system:codex:*` model, so
every Owner's Run draws on one person's plan. That is the prohibited pattern.
[^llame-codex-provider][^llame-available-models]

The compliant rule has two parts. A subscription Credential records the
identity that signed in, and a Run may use it only when the Run's Chat owner is
that identity. A second Owner needs a second Credential. llame must fail closed
rather than fall back to the shared login.

## OpenAI

### Consumer plans

ChatGPT Plus and Pro fall under the Terms of Use for individuals. Both the
non-EEA and the Europe versions forbid sharing in the same words. [^openai-tou-row][^openai-tou-eu]

> You may not share your account credentials or make your account available to
> anyone else and are responsible for all activities that occur under your
> account.

The help article states the rule in plain language, that the account is for
"the individual who created it", and that a second person should sign up for
their own account. [^openai-account-sharing]

Multiple devices are fine, which covers one person's Chats served from a
server. Multiple people are not. Codex draws its included usage from that same
personal plan. It offers sign-in with ChatGPT for subscription access and an
API key for usage-based access. [^openai-account-sharing][^codex-pricing][^codex-auth]

### Business and Enterprise

The Services Agreement governs the API, ChatGPT Business, ChatGPT Enterprise
and similar business services. It is explicit about sharing and seats.
[^openai-services-agreement]

> Customer will not share Account access credentials or individual login
> credentials between multiple users.

> End User Accounts may only be provisioned to, registered for, and used by, a
> single End User.

It also forbids reselling or leasing access to an account, and forbids
circumventing Usage Limits. Business is priced per user per month, which matches
the one-seat-per-person model. The allowed team shape is one workspace where
each member signs in with their own seat. [^openai-services-agreement][^codex-pricing]

### What OpenAI does allow

OpenAI documents server-side reuse of one person's subscription for that
person's own automation. The CI/CD guide copies one `auth.json` to a trusted
runner so the workflow runs "as your Codex account". It requires one file per
runner or serialized job stream, forbids concurrent jobs and multiple machines,
and excludes public repositories. [^codex-ci-cd-auth]

The app-server integration supports a host product. Its authentication modes
are per account, including an experimental mode where the host supplies a
user's access token and refreshes it. Rate limits are read per account, not per
installation. [^codex-app-server]

Both shapes are one person's credential used for that person's work. Neither
grants a second person the same login.

### Unsettled for llame

Every cited flow runs Codex itself, as CLI, SDK, app-server or IDE extension.
llame's provider instead replays ChatGPT tokens against the Codex backend. No
document blesses that, and the open-source licence does not settle service
terms. Confidence that OpenAI permits a separate client is medium
[INFERENCE, medium].

## Anthropic

### Consumer plans

The Consumer Terms state the sharing rule for Claude.ai, Pro, Max and Ultra
accounts. [^anthropic-consumer-terms]

> You may not share your Account login information, Anthropic API key, or
> Account credentials with anyone else or make your Account available to anyone
> else.

They also forbid automated or non-human access "Except when you are accessing
our Services via an Anthropic API Key or where we otherwise explicitly permit
it". Claude Code is the explicit permission. [^anthropic-consumer-terms]

The login help article adds the subscriber boundary. "Subscription plans can
only be used by subscribers", and plan usage is "designed to support ordinary
use of native Anthropic applications". For third-party tools it prefers an API
key or linked billing. It permits subscription-backed third-party use only at
Anthropic's discretion, billed to usage credits where Anthropic chooses, and
enforcement covers tools that route traffic against subscription limits.
[^claude-login]

The Claude Code legal page states the developer rule. Plan OAuth is "intended
exclusively for purchasers" of the plans. Anthropic "does not permit
third-party developers to offer Claude.ai login into their own applications".
It equally forbids routing requests "through Free, Pro, Max, or Ultra plan
credentials on behalf of their users". Developers may not collect, store or
intermediate Claude.ai credentials. Advertised limits "assume ordinary,
individual usage". Enforcement may come without prior notice. [^claude-legal]

An installation that serves one Owner's Chats from their own login sits closest
to "ordinary use". An installation that serves several Owners from one login is
routing plan credentials on behalf of users, which the same page forbids.

### Team and Enterprise

Anthropic's legal page assigns Team, Enterprise and API use to the Commercial
Terms. The seat article is the operative rule for plan credentials.
[^claude-legal][^claude-team-seats]

> Each seat on a Team plan is assigned to one named individual, and only that
> person may use it.

> Users can't route their work through another user's account to use that
> user's remaining usage.

Unused usage cannot move between seats, and reassignment is not "designed for
rotating one seat among several active users". [^claude-team-seats]

The Commercial Terms let a Customer power its own products and users, which
covers API keys and Console, not a shared Claude.ai seat. [^anthropic-commercial-terms]

## What llame must enforce

Installation and Owner are llame's own scopes. An installation is one deployed
llame over one database, and an Owner owns Chats. An Operator installs and
configures the installation. A subscription is a person's property, so the
provider identity, not the llame scope, decides who may use a Credential.
[^llame-glossary]

1. **Record the subscriber.** Every subscription Credential stores the provider
   account identity and email returned by the login, plus plan type. The record
   answers "whose subscription is this" without exposing secrets.
2. **Bind the Credential to the subscriber's Chats.** A Run may use a
   subscription Credential only when the Chat's Owner is that subscriber. This
   holds at installation scope and at owner scope.
3. **One Credential per Owner.** A second Owner who wants subscription access
   signs in for themselves. The installation cannot lend or rotate the first
   Owner's login.
4. **Fail closed, with a truthful failure.** An Owner without their own
   Credential gets an auth-class failure that names the cause. It is not a
   quota or a generic provider error. llame never silently falls back to
   another person's subscription.
5. **Prefer owner scope for subscription kinds.** Installation scope remains
   useful for a single-person installation and for the Operator's own Chats.
   Once owner credentials ship, a shared subscription Credential has no valid
   multi-owner use. [^llame-available-models]
6. **Do not read "trusted personal instance" as permission.** The provider page
   describes one trusted instance and no per-user linking. That wording was
   written for a single person and does not cover other Owners.
   [^llame-codex-provider]

Two consequences follow. First, the blocking condition is not the number of
Owners. It is whether the Run's Owner is the subscriber. Second, blocking a
second Owner at the push of a button is not enough. The offer to select a
subscription model must depend on the same binding, so an Owner never starts a
Run that can only fail.

For Claude, sharing adds a second problem to the accepted one. The stored
Claude credential already conflicts with the prohibition on collecting and
storing session tokens, which the map accepts as a risk. Serving several Owners
from one login adds the routing prohibition, and Anthropic reserves
enforcement without notice. [^claude-legal]

## Prior art

OMP, OpenClaw and OpenCode v2 are single-user installations. Each stores
credentials for the person who runs it, so none of them answers the multi-owner
question from practice [INFERENCE, high]. llame is the multi-owner case, which
is why the constraint must come from the terms and not from peer behavior.

## Confidence

- **High:** OpenAI consumer and business sharing prohibitions, quoted verbatim,
  reachable on 2026-11-20.
- **High:** Anthropic consumer, seat and third-party routing rules, quoted
  verbatim, reachable on 2026-11-20.
- **High:** llame's current shared behavior, from the provider page and the
  available-models spec.
- **Medium:** the non-EEA Anthropic consumer page carries an equivalent
  no-sharing clause. The page served to the reader was the EEA and Switzerland
  variant, and no separate United States variant was reachable [INFERENCE,
  medium].
- **Medium:** OpenAI tolerates a non-Codex client replaying subscription tokens.
  Documented flows all run Codex, so this stays unverified [INFERENCE, medium].

The enforcement design is a recommendation, not a legal conclusion. It matches
the strictest cited rule so one implementation covers both providers.

## Open questions

- Whether llame may use the Codex backend directly, or must run unmodified
  Codex through the SDK or app-server so the client is Codex.
- How llame proves that a provider identity is the Chat Owner when the sign-in
  email differs from the llame account email, as with Google or workspace SSO.
- What happens to a subscription Credential when its subscriber leaves the
  installation.

## Sources

[^openai-tou-row]: [OpenAI Terms of Use](https://openai.com/policies/row-terms-of-use/), published 2026-01-01, section "Registration and access": "You may not share your account credentials or make your account available to anyone else and are responsible for all activities that occur under your account." The same page forbids circumventing rate limits or restrictions.

[^openai-tou-eu]: [OpenAI Europe Terms of Use](https://openai.com/policies/eu-terms-of-use/), updated 2026-01-16, carries the same sharing sentence. The same page routes ChatGPT Enterprise, the API and other business services to the Business Terms.

[^openai-account-sharing]: [OpenAI Account Sharing Policy](https://help.openai.com/en/articles/10471989-openai-account-sharing-policy) says the account is for "the individual who created it" and that another person "should sign up for their own account". It allows multiple devices for that person and lists usage limits as a device caveat.

[^openai-services-agreement]: [OpenAI Services Agreement](https://openai.com/policies/services-agreement/), effective 2026-01-01, applies to the API, ChatGPT Enterprise, ChatGPT Business and similar services. Section 3.1 forbids sharing account access credentials or individual login credentials between multiple users, and forbids reselling or leasing account access. Section 3.2 allows one End User Account for one End User. Section 3.3 forbids circumventing Usage Limits.

[^codex-auth]: [Codex authentication](https://learn.chatgpt.com/docs/auth) describes sign-in with ChatGPT for subscription access and API keys for usage-based access. It warns against exposing Codex execution in untrusted or public environments.

[^codex-ci-cd-auth]: [Maintain Codex account auth in CI/CD](https://learn.chatgpt.com/docs/auth/ci-cd-auth) copies one `auth.json` to a trusted runner to run "as your Codex account". It requires one file per runner or serialized workflow stream and forbids sharing the file across concurrent jobs or machines. It excludes public repositories and recommends API keys by default.

[^codex-app-server]: [Codex App Server](https://learn.chatgpt.com/docs/app-server) is the interface for rich clients. Authentication modes cover API key, managed ChatGPT OAuth and experimental host-supplied ChatGPT tokens with host-side refresh. The documentation shows `account/rateLimits/read` per account.

[^codex-pricing]: [Codex pricing](https://learn.chatgpt.com/docs/pricing) lists per-user business pricing and included plan usage shared with ChatGPT agentic features.

[^anthropic-consumer-terms]: [Anthropic Consumer Terms of Service](https://www.anthropic.com/legal/consumer-terms), effective 2025-10-08. Section 2 forbids sharing account login information, API keys or credentials, and making the account available to anyone else. Section 3 restricts automated access except through an API key or where Anthropic explicitly permits it. The copy read carries an EEA and Switzerland applicability sentence.

[^anthropic-commercial-terms]: [Anthropic Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms), effective 2025-06-17. Section A.1 permits a Customer to use the Services, including to power products for its own users. Section D.5 makes the Customer responsible for activity under its account.

[^claude-legal]: [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) states that OAuth authentication is "intended exclusively for purchasers of Claude Free, Pro, Max, Ultra, Team, and Enterprise subscription plans". It states that Anthropic "does not permit third-party developers to offer Claude.ai login into their own applications". It also forbids routing requests "through Free, Pro, Max, or Ultra plan credentials on behalf of their users". It forbids collecting, storing or intermediating Claude.ai credentials. It says advertised limits assume ordinary, individual usage, and that enforcement may come without prior notice.

[^claude-login]: [Log in to your Claude account](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account) states that subscription plans "can only be used by subscribers" and that plan usage supports native Anthropic applications including Claude Code. It prefers API keys or linked billing for third-party tools, permits subscription-backed third-party use only at Anthropic's discretion with usage credits, and prohibits tools that misrepresent their identity or route traffic against subscription limits.

[^claude-team-seats]: [Purchase and manage seats on Team plans](https://support.claude.com/en/articles/12004354-purchase-and-manage-seats-on-team-plans), dated 2026-10-16, states that each seat belongs to one named individual and only that person may use it. It forbids sharing login credentials and routing work through another user's account, and forbids transferring unused usage between seats.

[^llame-codex-provider]: [Codex subscription provider](../../product/operator/providers/codex-subscription.md) describes `openai-codex` as letting one trusted personal instance use an operator's ChatGPT/Codex subscription, with no per-user account linking.

[^llame-available-models]: [available-models specification](../../../openspec/specs/available-models/spec.md) exposes the operator-configured model catalog, including `system:` entries, to every authenticated caller.

[^llame-glossary]: [Product glossary](../../product/glossary.md) defines Installation, Operator and Owner.
