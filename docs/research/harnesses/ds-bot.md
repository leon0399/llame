---
type: Reference
title: "DS Bot"
description: "Apache-2.0 DeepSeek Harness plugin whose Bots are root Sessions, whose desktop feed is a change hint, and whose Docker image grants full access inside one container."
resource: "https://github.com/Fei2411/DS-Bot/tree/71d344bf193f3f18185f25de3d8e5c483046910a"
tags: [harness, sessions, events, memory, routines, sandbox, desktop]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-04"
observed:
  date: "2026-11-04"
  revision: "71d344bf193f3f18185f25de3d8e5c483046910a"
sources:
  - id: dsbot-license
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/LICENSE#L1-L3"
    title: "Apache License 2.0 heading"
  - id: dsbot-pkg
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/package.json#L2-L4"
    title: "Plugin package ds-bot 0.2.7"
  - id: dsbot-app
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/package.json#L2-L6"
    title: "Desktop app description and version 0.2.7"
  - id: dsbot-dsh
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/package.json#L28"
    title: "Desktop app pins @deepseek-ai/dsh 0.2.1-rc.5"
  - id: dsbot-readme
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/README.md#L167"
    title: "Community project, not an official DeepSeek product"
  - id: dsbot-entry
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/index.js#L1-L3"
    title: "Each Bot is one root Session; the roster is one JSON file"
  - id: dsbot-home
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/index.js#L63-L71"
    title: "Team home defaults to DSH_HOME/bot and state.json"
  - id: dsbot-main
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/store.js#L411-L421"
    title: "isMain, hidden group Sessions, and a stable Bot id"
  - id: dsbot-lock
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/store.js#L55-L66"
    title: "A lock that cannot be created leaves the host unlocked"
  - id: dsbot-tools
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/tools.js#L21-L29"
    title: "Delegation tools are hidden; message_bot is the handoff"
  - id: dsbot-guard
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/tools.js#L786-L814"
    title: "Team tools register on the Bot Session's own scope"
  - id: dsbot-refuse
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/tools.js#L907-L914"
    title: "The guard refuses the blocking question and delegation tools, not the goal names"
  - id: dsbot-filter
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/tools.js#L841-L849"
    title: "The assembly listener drops hidden tool names from the prompt"
  - id: dsbot-goal
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/tools.js#L986-L1003"
    title: "An active DSH goal on a Bot Session or the group's own Session is blocked"
  - id: dsbot-labels
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/client/permission-picker.js#L5"
    title: "The picker maps read-only, workspace-write, and danger-full-access to display labels"
  - id: dsbot-delete
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/roster.js#L689-L692"
    title: "deleteBot refuses while the Bot is still a Main Bot"
  - id: dsbot-delete-route
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/channel.js#L291-L294"
    title: "delete-bot is a channel endpoint"
  - id: dsbot-perm
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/permissions.js#L1-L38"
    title: "Presets come from DSH; auto is dropped; the name is written onto the Session"
  - id: dsbot-compact
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/parts.js#L256-L306"
    title: "DSH compaction is a no-op on Bot Sessions; summarize is wrapped"
  - id: dsbot-lines
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/steward.js#L11-L26"
    title: "Check line defaults to 0.8 of the usable window; hard line is 0.95"
  - id: dsbot-decide
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/parts.js#L594-L605"
    title: "A missing or failed steward returns switch"
  - id: dsbot-note
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/parts.js#L954-L976"
    title: "A Bot tries a handoff note; below the hard line a failure stays; past it, a previous note is copied when one exists"
  - id: dsbot-feed
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/feed.js#L1-L30"
    title: "Feed events, and a controller is dropped when desiredSize is below -512"
  - id: dsbot-keepalive
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/feed.js#L104-L106"
    title: "The keepalive interval calls the same send helper"
  - id: dsbot-hello
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/feed.js#L85-L100"
    title: "hello carries the team revision"
  - id: dsbot-poll
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/client/index.js#L163-L166"
    title: "The plugin page polls state with since set to the revision"
  - id: dsbot-interval
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/client/index.js#L235"
    title: "Visible poll is 1.5 s; a hidden page waits 10 s"
  - id: dsbot-since
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/channel.js#L181-L186"
    title: "An unchanged revision returns unchanged, plus live fields when the key differs"
  - id: dsbot-catchup
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/ui/src/team.js#L17-L19"
    title: "hello, revision, and live are state reads; the catch-up interval is 15 s"
  - id: dsbot-tick
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/ui/src/team.js#L233-L237"
    title: "The window opens the feed and keeps a 15 s state poll"
  - id: dsbot-reload
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/ui/src/chat.js#L54-L56"
    title: "hello reloads the chat page because entries may have been missed"
  - id: dsbot-page
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/parts.js#L1306-L1443"
    title: "Earlier chat pages 60 Session events and returns part plus beforeSeq"
  - id: dsbot-memory
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/memory.js#L42"
    title: "Memory limits: 300, 4000, 16000, and 40 topics"
  - id: dsbot-freeze
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/memory.js#L1038-L1067"
    title: "Own memory freezes in the prompt; group memory is a snapshot message"
  - id: dsbot-review
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/memory.js#L1694-L1699"
    title: "Idle review reads new lines and edits entries"
  - id: dsbot-review-on
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/memory.js#L471"
    title: "memoryReview defaults on unless config sets it false"
  - id: dsbot-idle
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/memory.js#L2003-L2028"
    title: "Review queues 2 s after the Session goes idle, unless memoryReview is false"
  - id: dsbot-sched
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/schedules.js#L1-L7"
    title: "DSH stores a task on a Session and sends its prompt when due"
  - id: dsbot-when
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/schedules.js#L42-L68"
    title: "The settings form accepts at, daily, weekly, and every up to 7 days"
  - id: dsbot-create
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/schedules.js#L112-L122"
    title: "Create writes the task on the Bot's current chat or the group's Session"
  - id: dsbot-move
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/schedules.js#L133-L149"
    title: "A fresh part copies tasks, then deletes the old ones"
  - id: dsbot-docker
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/docker/docker.patch.yml#L1-L15"
    title: "The container is the boundary; the only preset is danger-full-access with approval never"
  - id: dsbot-bind
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/docker/entrypoint.sh#L28-L32"
    title: "The overlay binds all interfaces because --host accepts only 127.0.0.1"
  - id: dsbot-compose
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/docker-compose.yml#L14-L16"
    title: "Compose publishes 0.0.0.0:13080 to container port 3080"
  - id: dsbot-loopback
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/engine/cordis.patch.yml#L18-L26"
    title: "The desktop engine webserver binds 127.0.0.1 and port 0"
  - id: dsbot-folders
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/folders.js#L111-L113"
    title: "workFolder throws when the path holds DeepSeek Harness data"
  - id: dsbot-privacy
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/privacy.js#L1-L4"
    title: "Path checks are not a fence; a shell can still reach the account's files"
  - id: dsbot-privacy-args
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/privacy.js#L249-L272"
    title: "Private-Bot checks cover file, search, and shell arguments"
  - id: dsbot-secret
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/secrets.js#L14-L62"
    title: "Redaction replaces the value, its JSON escape, and its URL encoding"
  - id: dsbot-secret-min
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/secrets.js#L283-L286"
    title: "A secret shorter than 4 characters is rejected"
  - id: dsbot-engine
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/engine/index.js#L1-L18"
    title: "The engine index exchanges a launch token and serves no page"
  - id: dsbot-mobile
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/mobile/App.tsx#L8-L11"
    title: "The mobile screen tells the user to pair and implements no connection"
  - id: dsbot-vision
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/docs/vision.md#L31"
    title: "Local agent CLIs as Bots are marked planned"
  - id: dsbot-agent
    resource: "https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/agents.js#L1-L3"
    title: "The DSH Agent is one plain Session list, without team tools"
---

# DS Bot

- **Stack:** JavaScript plugin `ds-bot` 0.2.7 and Electron app `dsbot` 0.2.7, Apache-2.0.[^dsbot-license][^dsbot-pkg][^dsbot-app] The app description says it runs that plugin on its own pinned DeepSeek Harness, and the app pins `@deepseek-ai/dsh` at `0.2.1-rc.5`.[^dsbot-dsh] The README says this is a community project.[^dsbot-readme] Source inspection of the plugin host, the desktop window, and the Docker overlay. The `@deepseek-ai/*` packages were not opened, and nothing was run.

[DeepSeek Harness](./deepseek-harness.md) owns the Session projection, the tool runtime, and approvals. [Tobs](./tobs.md) is the BotHarness DeepSeekBot plugin. [DeepSeek Super-agent](./dsh-superagent.md) is DeepSeek's router/worker prototype. This page is Fei2411/DS-Bot.

**Study**

1. **Each Bot is one root Session, and the team list is `state.json`.** The plugin entry says every Bot is one ordinary dsh root Session, and the roster, rooms, and bot-to-bot exchange log live in one JSON file so they survive restarts without new Session event types.[^dsbot-entry] `createRuntime` puts that file at `$DSH_HOME/bot/state.json` unless config sets `home`.[^dsbot-home] `isMain` is membership in `state.mainBotIds`. A group member speaks from a hidden Session of its own, created on the first turn there, with the same system prompt and tools as the private chat. The Bot id stays the first own-chat Session id.[^dsbot-main] A host that finds `state.lock` held by another dsh is read-only. A lock that cannot be created is warned, and that host continues unlocked.[^dsbot-lock] llame keeps Chat and Run identity in the database, and peers stay [executor adapters](../../../VISION.md#runs-are-the-unit-of-execution). A roster file beside the harness Sessions is a second store for membership. It is not a second run log.
2. **Team tools are scoped to the Bot Session. Subagent tools are refused.** The hidden list covers DSH's blocking question, its goal tools (`create_goal`, `update_goal`, `get_goal`), and delegation names including `subagent`, `workflow`, and `ralph`. The delegation refusal tells the model to hand work to another Bot with `message_bot`.[^dsbot-tools] On a Bot Session (`chatOwners` or `groupOwners`), `shareBotTools` registers every team tool on that Agent's own scope. The group's own Session is not a Bot Session, and it receives only `group_relay`.[^dsbot-guard] The execution guard refuses the blocking question and the delegation names.[^dsbot-refuse] It does not refuse the goal-tool names. On a Bot Session, the assembly listener drops those names from the prompt.[^dsbot-filter] An active DSH goal on a Bot Session or the group's own Session is blocked with a not-supported message.[^dsbot-goal] `deleteBot` throws while the id is still a Main Bot. The delete is the `delete-bot` channel endpoint.[^dsbot-delete][^dsbot-delete-route] The team tools include `delete_group` and `delete_capability`, and no tool named for deleting a Bot. Permission presets are whatever DSH's `permissionPresets` service catalogs, minus the session-only value `auto`, and DS Bot writes the chosen name onto the Bot's Sessions.[^dsbot-perm] The permission picker maps `read-only`, `workspace-write`, and `danger-full-access` to Read only, Workspace, and Full access.[^dsbot-labels] The preset bodies for the first two are not in this repository. The Docker overlay defines `danger-full-access`. llame's child agents, when that slice is planned, are [child Chats with child Runs](../../../VISION.md#runs-are-the-unit-of-execution). Hidden group Sessions are a second conversation under one Bot id. That shape is a record, not a proposal to copy.
3. **Long Bot Sessions skip DSH compaction, and a steward chooses condense or switch.** `compactIfNeeded` returns null for a Bot or group Session, and `/compact` is rejected with a fixed error. DS Bot condenses only when the steward says so, through a wrapped `summarize`.[^dsbot-compact] The usable window is the declared context window minus the reply reserve, and at least half the declared window. The hard line is 95% of usable. The check line defaults to 80% of usable, capped by the hard line. A model that declares no window is treated as 500,000.[^dsbot-lines] `decide` returns `switch` when no compaction engine is available, when the steward's text has no `switch` or `compact` action, or when the call throws.[^dsbot-decide] For a Bot, `startSwitch` still tries to write a handoff note. The group's own Session skips that call. Below the hard line, a note that does not land leaves the current part in place. At or past the hard line, the part moves. If this attempt wrote no note and the previous part has one, that note is copied; otherwise the package records a fallback reason and no note text.[^dsbot-note] llame's [compaction checkpoint](../../../SPEC.md#21-compaction-checkpoint) leaves source messages in place and stores one summary row. DS Bot either condenses inside the Session or archives that Session and opens another, and the chat view pages the older parts as one conversation.
4. **The desktop feed is a change hint. History pages Session events.** The plugin page polls `state` with `since` set to the team revision, every 1.5 s while the page is visible and every 10 s while it is hidden.[^dsbot-poll][^dsbot-interval] A matching revision returns `unchanged`, and a new live key includes the live fields without a new team revision.[^dsbot-since] The Electron window also opens `GET /api/bot/feed` (`text/event-stream`). The host comment names four events: `revision` after a save, `live` when work changes without a save, `message` for a new own-chat entry, and `stream` for text as it is written. `send` drops a controller whose stream `desiredSize` is below -512. The comment calls that 512 waiting events.[^dsbot-feed] The keepalive interval uses that same `send`.[^dsbot-keepalive] The dropped window is expected to catch up from `hello`. `hello` is `{ revision }` only.[^dsbot-hello] The window reads state again on `hello`, `revision`, and `live`, and `start` also polls state on `CATCH_UP_MS` (15 s).[^dsbot-catchup][^dsbot-tick] The chat comment says a feed that returns after a break may have missed entries, and `hello` reloads the current page.[^dsbot-reload] Earlier messages come from DSH `sessionController.page`, 60 events a page, using `beforeSeq` when the cursor has one. The returned cursor is `{ part, beforeSeq }` while that part has more, otherwise the previous part.[^dsbot-page] llame's [run events](../../../SPEC.md#94-run-events) are the reconnect record. The [SSE bridge](../../../apps/api/src/runs/run-stream-bridge.ts) re-reads that log from the start of the connection and translates it into UI chunks. A first-party CLI is [unselected backlog](../../../ROADMAP.md#backlog-standalone-personal-node-and-cli). [VISION](../../../VISION.md#local-capability-is-not-a-thin-client) lists the CLI as one Surface beside web, desktop, and Android. This repository has no terminal UI.
5. **Memory is Markdown, frozen per Session, with an idle review.** Limits are 300 characters an entry, 4,000 for `MEMORY.md`, 16,000 for a topic, and 40 topics.[^dsbot-memory] The `bot-memory` prompt section freezes that text for the Session. A group Session keeps the Bot's prompt and, on `agent/pre-step`, receives the group's memory as a user message whose source kind is `ds-bot-group-memory` and whose form is `snapshot`. That insert is skipped when the prompt section already contains the group heading, or when the history already has that message. The comment says the prompt then stays the Bot's own so the provider prefix cache is shared.[^dsbot-freeze] `memoryReview` defaults on (`!== false`).[^dsbot-review-on] Unless it is false, idle waits 2 s and queues a review. The review comment says a model reads what is new and keeps, changes, or removes entries: a Bot's own chat into its memory, a group once into the group memory.[^dsbot-review][^dsbot-idle] llame's [Knowledge is curated Markdown](../../../VISION.md#memory-has-distinct-stores), and automatic extraction and injection remain deferred. A frozen memory section is a prefix-resident statement. Shipping the idle review would be a proposal against that deferral. The group snapshot is a cache choice. llame's context items are narrated, server-authored data.
6. **Routines are DSH tasks bound to a Session.** The module comment says DSH stores each task with its Session and, when it is due, sends the prompt as a new message. The service is optional, and the endpoints say so when it is absent.[^dsbot-sched] Create targets the Bot's current chat Session or the group's own Session.[^dsbot-create] The settings form accepts `at`, `daily`, `weekly`, and `every` from 1 minute through 7 days.[^dsbot-when] A fresh part copies each still-future task onto the new Session and then deletes the old record. A failed delete is logged; the comment says the copy stays.[^dsbot-move] The roadmap stages read for this note do not ship a llame routine product. A prompt injected into a DSH Session is a different object from a [Run](../../../VISION.md#runs-are-the-unit-of-execution).
7. **Docker grants full access inside one container. The desktop engine stays on loopback.** The image overlay says the container is the sandbox boundary, offers only `danger-full-access`, and sets approval to `never`. The Bot workspace in that overlay is `/workspace`.[^dsbot-docker] The entrypoint says this dsh release accepts only `127.0.0.1` for `--host`, so the overlay binds all interfaces and the publish rule is the network boundary.[^dsbot-bind] Compose publishes `0.0.0.0:13080` to container port 3080.[^dsbot-compose] The desktop engine webserver binds `127.0.0.1` and port 0.[^dsbot-loopback] A working folder that contains DSH data or the team data is refused.[^dsbot-folders] Private-Bot checks look at file, search, and shell arguments.[^dsbot-privacy-args] The privacy header says DSH does not fence reads, and a shell can still reach any file the account can.[^dsbot-privacy] llame's [local Sandbox](../../../ROADMAP.md#then-local-sandbox-execution) comes after the Node runtime, and Sandbox failure never falls back to native execution. DS Bot's container preset is one full-access grant. It is a caution.
8. **The shipped window is Electron. The phone file does not pair.** The engine index exchanges a launch token and serves no application page.[^dsbot-engine] The window is the app's own UI. It reads `state` and the feed, as in item 4. `mobile/App.tsx` renders "Pair with your computer to reach your Bot team" and contains no connection code.[^dsbot-mobile] The vision list marks local agent CLIs as planned.[^dsbot-vision] `agents.js` is one plain DSH entry beside the Bots, and its Sessions do not receive the team tools.[^dsbot-agent] [VISION](../../../VISION.md#local-capability-is-not-a-thin-client) describes Android as a local node with fewer capabilities, including remote Run steering. A phone that only controls a computer would be a Surface. The pairing design in `docs/plans/` was not implemented in `mobile/`.

**llame fit**

- High: item 4. A Surface attached to a running turn should read the persisted log. DS Bot's feed tells the window to refetch, and `hello` reloads a page.
- High: item 1, beside the DeepSeek Harness note. One session authority. A roster file is membership, not a run log.
- Moderate: item 5 as a file shape for memory the owner can open. The idle review stays inside the deferred extraction.
- Moderate: item 2 as a record that this product hid the harness subagent tools and used `message_bot`. llame's later child-agent shape remains the child Chat.
- Moderate: item 3 as a boundary. A steward failure is recorded as `switch`, and the part moves when the handoff note lands or the context is already at the hard line. llame's checkpoint leaves the source rows.
- Low: item 6. Copy-then-delete is the hazard if a later routine is keyed by a session id that changes.
- Low: item 7. Approval `never` inside the container is this image's choice.
- Low: item 8 until pairing exists in source. There is no terminal UI in this tree.

**Caution:** An unusable `state.lock` leaves two hosts able to write the team file.[^dsbot-lock] Secret redaction replaces the exact value, its JSON escaping, and its URL encoding. A stored value shorter than 8 characters matches only with no letter or digit against it.[^dsbot-secret] `cleanValue` rejects a string shorter than 4 characters.[^dsbot-secret-min] A steward that cannot answer is treated as `switch`.[^dsbot-decide] The read-only and workspace-write preset bodies live in DSH and were not opened. The picker labels and the Docker full-access preset were read here. The phone screen and the local-CLI bots are vision text. Nothing was run.

[^dsbot-license]: [Apache License 2.0 heading](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/LICENSE#L1-L3)

[^dsbot-pkg]: [Plugin package ds-bot 0.2.7](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/package.json#L2-L4)

[^dsbot-app]: [Desktop app description and version 0.2.7](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/package.json#L2-L6)

[^dsbot-dsh]: [Desktop app pins @deepseek-ai/dsh 0.2.1-rc.5](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/package.json#L28)

[^dsbot-readme]: [Community project, not an official DeepSeek product](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/README.md#L167)

[^dsbot-entry]: [Each Bot is one root Session; the roster is one JSON file](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/index.js#L1-L3)

[^dsbot-home]: [Team home defaults to DSH_HOME/bot and state.json](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/index.js#L63-L71)

[^dsbot-main]: [isMain, hidden group Sessions, and a stable Bot id](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/store.js#L411-L421)

[^dsbot-lock]: [A lock that cannot be created leaves the host unlocked](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/store.js#L55-L66)

[^dsbot-tools]: [Delegation tools are hidden; message_bot is the handoff](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/tools.js#L21-L29)

[^dsbot-guard]: [Team tools register on the Bot Session's own scope](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/tools.js#L786-L814)

[^dsbot-refuse]: [The guard refuses the blocking question and delegation tools, not the goal names](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/tools.js#L907-L914)

[^dsbot-filter]: [The assembly listener drops hidden tool names from the prompt](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/tools.js#L841-L849)

[^dsbot-goal]: [An active DSH goal on a Bot Session or the group's own Session is blocked](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/tools.js#L986-L1003)

[^dsbot-labels]: [The picker maps read-only, workspace-write, and danger-full-access to display labels](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/client/permission-picker.js#L5)

[^dsbot-delete]: [deleteBot refuses while the Bot is still a Main Bot](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/roster.js#L689-L692)

[^dsbot-delete-route]: [delete-bot is a channel endpoint](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/channel.js#L291-L294)

[^dsbot-perm]: [Presets come from DSH; auto is dropped; the name is written onto the Session](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/permissions.js#L1-L38)

[^dsbot-compact]: [DSH compaction is a no-op on Bot Sessions; summarize is wrapped](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/parts.js#L256-L306)

[^dsbot-lines]: [Check line defaults to 0.8 of the usable window; hard line is 0.95](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/steward.js#L11-L26)

[^dsbot-decide]: [A missing or failed steward returns switch](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/parts.js#L594-L605)

[^dsbot-note]: [A Bot tries a handoff note; below the hard line a failure stays; past it, a previous note is copied when one exists](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/parts.js#L954-L976)

[^dsbot-feed]: [Feed events, and a controller is dropped when desiredSize is below -512](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/feed.js#L1-L30)

[^dsbot-keepalive]: [The keepalive interval calls the same send helper](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/feed.js#L104-L106)

[^dsbot-hello]: [hello carries the team revision](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/feed.js#L85-L100)

[^dsbot-poll]: [The plugin page polls state with since set to the revision](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/client/index.js#L163-L166)

[^dsbot-interval]: [Visible poll is 1.5 s; a hidden page waits 10 s](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/client/index.js#L235)

[^dsbot-since]: [An unchanged revision returns unchanged, plus live fields when the key differs](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/channel.js#L181-L186)

[^dsbot-catchup]: [hello, revision, and live are state reads; the catch-up interval is 15 s](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/ui/src/team.js#L17-L19)

[^dsbot-tick]: [The window opens the feed and keeps a 15 s state poll](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/ui/src/team.js#L233-L237)

[^dsbot-reload]: [hello reloads the chat page because entries may have been missed](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/ui/src/chat.js#L54-L56)

[^dsbot-page]: [Earlier chat pages 60 Session events and returns part plus beforeSeq](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/parts.js#L1306-L1443)

[^dsbot-memory]: [Memory limits: 300, 4000, 16000, and 40 topics](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/memory.js#L42)

[^dsbot-freeze]: [Own memory freezes in the prompt; group memory is a snapshot message](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/memory.js#L1038-L1067)

[^dsbot-review]: [Idle review reads new lines and edits entries](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/memory.js#L1694-L1699)

[^dsbot-review-on]: [memoryReview defaults on unless config sets it false](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/memory.js#L471)

[^dsbot-idle]: [Review queues 2 s after the Session goes idle, unless memoryReview is false](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/memory.js#L2003-L2028)

[^dsbot-sched]: [DSH stores a task on a Session and sends its prompt when due](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/schedules.js#L1-L7)

[^dsbot-when]: [The settings form accepts at, daily, weekly, and every up to 7 days](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/schedules.js#L42-L68)

[^dsbot-create]: [Create writes the task on the Bot's current chat or the group's Session](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/schedules.js#L112-L122)

[^dsbot-move]: [A fresh part copies tasks, then deletes the old ones](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/schedules.js#L133-L149)

[^dsbot-docker]: [The container is the boundary; the only preset is danger-full-access with approval never](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/docker/docker.patch.yml#L1-L15)

[^dsbot-bind]: [The overlay binds all interfaces because --host accepts only 127.0.0.1](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/docker/entrypoint.sh#L28-L32)

[^dsbot-compose]: [Compose publishes 0.0.0.0:13080 to container port 3080](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/docker-compose.yml#L14-L16)

[^dsbot-loopback]: [The desktop engine webserver binds 127.0.0.1 and port 0](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/engine/cordis.patch.yml#L18-L26)

[^dsbot-folders]: [workFolder throws when the path holds DeepSeek Harness data](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/folders.js#L111-L113)

[^dsbot-privacy]: [Path checks are not a fence; a shell can still reach the account's files](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/privacy.js#L1-L4)

[^dsbot-privacy-args]: [Private-Bot checks cover file, search, and shell arguments](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/privacy.js#L249-L272)

[^dsbot-secret]: [Redaction replaces the value, its JSON escape, and its URL encoding](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/secrets.js#L14-L62)

[^dsbot-secret-min]: [A secret shorter than 4 characters is rejected](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/secrets.js#L283-L286)

[^dsbot-engine]: [The engine index exchanges a launch token and serves no page](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/app/engine/index.js#L1-L18)

[^dsbot-mobile]: [The mobile screen tells the user to pair and implements no connection](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/mobile/App.tsx#L8-L11)

[^dsbot-vision]: [Local agent CLIs as Bots are marked planned](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/docs/vision.md#L31)

[^dsbot-agent]: [The DSH Agent is one plain Session list, without team tools](https://github.com/Fei2411/DS-Bot/blob/71d344bf193f3f18185f25de3d8e5c483046910a/ds-bot/src/host/agents.js#L1-L3)
