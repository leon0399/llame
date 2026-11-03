---
type: Reference
title: "Tamekoshi"
description: "Waitlist desktop companion advertised above coding agents. No public repository was located; the feature list is the site and the tierroom board."
resource: "https://www.tamekoshi.com/"
tags: [harness, desktop, companion, closed]
status: draft
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
sources:
  - id: tamekoshi-board
    resource: "https://my-tierroom.party/agents/tamekoshi"
    title: "Tierroom board page for Tamekoshi"
  - id: tamekoshi-site
    resource: "https://www.tamekoshi.com/"
    title: "Tamekoshi marketing site"
  - id: tamekoshi-privacy
    resource: "https://www.tamekoshi.com/privacy"
    title: "Tamekoshi privacy policy"
---

# Tamekoshi

- **Stack:** Unverified. The site is a live page and is not pinned. No public source repository was located in this pass, so there is no `observed` revision. The [tierroom board](https://my-tierroom.party/agents/tamekoshi) reports a private beta, a waitlist, and a linked GitHub URL that returned 404 on the board's review. This pass did not repeat that fetch.

Tamekoshi is included because the batch asked for it. The note records claims. It does not record an implementation.

**Study**

1. **The board describes a companion above coding agents.** It says the app sits in a screen notch or top-edge island, shows coding-agent activity and approvals, and offers companion chats, memory, MCP connections, skills, and a credential vault. Windows and Linux are described with meeting transcription, messaging channels, and companion-owned Linux computers. macOS is described as a smaller set. Access is a waitlist. The board says the site's demos are scripted and use fictional data.[^tamekoshi-board]
2. **The site repeats a personal-assistant pitch.** The homepage describes voice calls, background work, meeting notes, and channel access, and labels a sample as a scripted product sample with fictional data. It says a bot computer is an isolated Linux desktop on Windows and Linux. Coding-agent support on the page, as captured by search snippets of that page, names Claude Code broadly and Cursor, Codex, Gemini CLI, and Antigravity with platform differences. Those sentences were not re-read as a pinned document.[^tamekoshi-site]
3. **The privacy policy locates data.** It says messages and added context go to the AI provider chosen for each companion, that connected-app calls go to those apps, and that optional Windows and Linux computer screenshots and tool results go to the chosen provider. It says the publisher is kumanaya. It does not publish the application source.[^tamekoshi-privacy]

**llame fit**

- Low, until source exists. A companion that displays another harness's approvals is a Surface. Whether it can fail closed when the companion is absent is a board claim (hooks exit immediately if the app is absent, and the board also says hooks fail open when the app is not running). Those two board sentences were not reconciled against code.
- Avoid: treating the site's Linux computer, MCP catalog, or approval defaults as mechanisms. [The harness owns execution](../../../VISION.md#the-harness-owns-execution) cannot be checked here.

**Caution:** License, price, and which agents are actually connected are unverified. The board's integration counters were reported as zero. Nothing was installed.

[^tamekoshi-board]: [Tierroom board page for Tamekoshi](https://my-tierroom.party/agents/tamekoshi)

[^tamekoshi-site]: [Tamekoshi marketing site](https://www.tamekoshi.com/)

[^tamekoshi-privacy]: [Tamekoshi privacy policy](https://www.tamekoshi.com/privacy)
