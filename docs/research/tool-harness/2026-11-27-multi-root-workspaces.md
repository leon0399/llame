---
type: Research
title: "Workspaces with several roots in agent tools"
description: "Compares multi-root workspace models, authorization, instruction discovery, model-visible root identity, and manifest-managed repository spokes."
tags:
  - agent-harness
  - workspace
  - multi-root
status: draft
summary: "Multi-root is not one shared capability: IDE workspaces aggregate roots, agent CLIs expose distinct authorization and instruction rules, while manifests provision spokes on disk. Worktrees preserve only roots that are actually present."
read_when:
  - designing multi-root Chat workspaces
  - comparing agent tools' added-directory permissions and instructions
  - deciding how a manifest-backed hub should expose repositories in worktrees
observed:
  date: 2026-11-27
  revisions:
    llame: 751bb05
    oh-my-pi: d8816b454fa2054b6717d763b69997680b8e9908
    oh-my-pi-multi-root-merge: 26726fdcb91cbacdd40e25dad60a1ba05552a898
sources:
  - id: git-worktree
    resource: "https://git-scm.com/docs/git-worktree/2.56.0"
    title: "Git worktree documentation, version 2.56.0"
  - id: claude-permissions
    resource: "https://code.claude.com/docs/en/permissions"
    title: "Claude Code permissions and working directories"
  - id: claude-memory
    resource: "https://code.claude.com/docs/en/memory"
    title: "Claude Code memory and additional directories"
  - id: codex-cli-reference
    resource: "https://developers.openai.com/codex/cli/reference"
    title: "Codex CLI command-line reference"
  - id: codex-sandbox
    resource: "https://developers.openai.com/codex/sandboxing"
    title: "Codex sandbox"
  - id: vscode-multi-root
    resource: "https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces"
    title: "VS Code multi-root workspaces"
  - id: cursor-files
    resource: "https://docs.cursor.com/context/@-symbols/@-files-and-folders"
    title: "Cursor files and folders context"
  - id: zed-projects
    resource: "https://zed.dev/docs/windows-and-projects"
    title: "Zed windows and projects"
  - id: zed-instructions
    resource: "https://zed.dev/docs/ai/instructions"
    title: "Zed instructions"
  - id: opencode-permissions
    resource: "https://opencode.ai/docs/permissions"
    title: "OpenCode permissions"
  - id: opencode-instructions
    resource: "https://opencode.ai/docs/instructions"
    title: "OpenCode instructions"
  - id: gemini-commands
    resource: "https://geminicli.com/docs/reference/commands"
    title: "Gemini CLI commands"
  - id: gemini-configuration
    resource: "https://geminicli.com/docs/reference/configuration"
    title: "Gemini CLI configuration"
  - id: west-workspaces
    resource: "https://docs.zephyrproject.org/latest/develop/west/workspaces.html"
    title: "West workspaces"
  - id: omp-pr
    resource: "https://github.com/can1357/oh-my-pi/pull/6255"
    title: "oh-my-pi dynamic multi-root change"
  - id: omp-workspace
    resource: "https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/session/session-workspace.ts"
    title: "oh-my-pi session workspace normalization"
  - id: omp-context
    resource: "https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/system-prompt.ts"
    title: "oh-my-pi context and workspace prompt assembly"
  - id: omp-prompt
    resource: "https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/prompts/system/project-prompt.md"
    title: "oh-my-pi workspace roots prompt block"
  - id: omp-command
    resource: "https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/slash-commands/builtin-registry.ts"
    title: "oh-my-pi workspace root commands"
  - id: omp-cli
    resource: "https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/main.ts"
    title: "oh-my-pi CLI and settings root wiring"
  - id: omp-settings
    resource: "https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/config/settings-schema.ts"
    title: "oh-my-pi additional root setting"
  - id: omp-tree
    resource: "https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/workspace-tree.ts"
    title: "oh-my-pi workspace tree and AGENTS.md discovery"
  - id: omp-subagents
    resource: "https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/task/executor.ts"
    title: "oh-my-pi subagent workspace isolation"
---

# Workspaces with several roots in agent tools

## Summary

Multi-root can mean at least three different things: several editor folders, an agent's filesystem authorization boundary, or a manifest that provisions several repositories. These are separate capabilities. An editor can display several roots without defining agent permissions. A CLI can grant access to a directory without loading its instructions. A manifest can define repositories without integrating them into a chat's workspace.

oh-my-pi is especially relevant prior art: its dynamic session root list is persisted and surfaced to the model. VS Code-style named folders remain the clearest human-facing root labels, but do not define agent permission semantics. Among CLI peers, Gemini CLI exposes multi-directory membership directly. Codex exposes additional writable roots through `--add-dir` in `workspace-write`. Claude Code retains one primary working directory when adding directories. OpenCode checks external directory boundaries separately from its active Location. Zed distinguishes multiple projects from adding folders to one project. [^omp-pr]

For a hub whose ignored `checkouts/<name>` disappear in a hub worktree, the worktree contains no spoke checkout to expose. A manifest can recreate or update spokes at declared paths, but the tooling must explicitly do that after worktree creation. A linked worktree of the hub does not automatically make untracked or ignored peer repositories appear there.

## Compared behavior

| Tool                      | How roots are added                                                                                                             | Primary versus added                                                                                                                                          | Permission scope                                                                                                                                                                                            | Instructions from added roots                                                                                                                                                          | Root names/model context                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Claude Code               | `--add-dir` at launch, `/add-dir` during a session, or `additionalDirectories` in settings.                                     | Launch directory remains primary until `/cd`. Added directories extend access, not the primary cwd.                                                           | Read-only file tools cover working and additional directories. Edit/write tools are permission checked. `acceptEdits` applies to both. Bash separately uses command permissions and sandbox policy.         | Not by default. `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` opts into loading CLAUDE.md and related instruction files from added directories.                                     | Model receives filesystem paths and primary cwd. Docs specify access boundaries, but do not define a friendly alias/name API. |
| Codex CLI                 | `--add-dir` adds directories. Config may specify sandbox writable roots.                                                        | Current working directory remains the initial workspace. Added directory is a separately authorized root.                                                     | `workspace-write` permits writes in the workspace and configured writable roots. The CLI reference documents `--add-dir`. Precise UI/model presentation is not documented here.                             | No claim that added directories' instruction files load was established from reviewed official source.                                                                                 | Roots are path-addressed. No user-defined root label documented in reviewed sources.                                          |
| VS Code `.code-workspace` | `folders` array, UI Add Folder, or `code --add`.                                                                                | Each folder is a named workspace root. Editor docs establish no distinguished agent primary root.                                                             | Editor file access is not an agent authorization boundary. Extensions or agents define their own policies.                                                                                                  | Not an agent instruction loader. `.vscode` per-folder settings may apply.                                                                                                              | `name` overrides displayed folder label. Paths may be absolute or relative to the `.code-workspace` file.                     |
| Cursor `.code-workspace`  | Uses VS Code multi-root workspace format.                                                                                       | Editor workspace roots. They are not necessarily agent roots.                                                                                                 | Workspace membership must not be inferred as an agent permission grant. Cursor agent policy is separate.                                                                                                    | `.cursor/rules` and referenced context are Cursor-specific. Evidence reviewed does not establish automatic instructions from every folder.                                             | Folder display names come from workspace metadata. Cursor @Files/Folders can supply explicit context.                         |
| Zed                       | Add Folder to Project makes it an additional root. `zed --add` adds a project to the window's project sidebar.                  | Multiple projects have separate file trees, git state, search scopes, and project-bound agent threads. Additional roots can belong to one project.            | Docs establish project organization, not a sandbox permission boundary.                                                                                                                                     | Zed Agent uses the current project's supported instruction-file selection, including AGENTS.md and CLAUDE.md. No evidence here that every added root contributes its instruction file. | Project identity and root path appear to be project-level. No stable model-facing custom alias contract is documented.        |
| OpenCode                  | Workspace is the active location. File tools may reach external directories subject to `external_directory` policy.             | One active Location. External paths are distinct, not named workspace roots.                                                                                  | Permissions include external-directory boundaries plus read/edit rules. Defaults allow external directories. Users can request or deny access. Shell checks inferred external paths on a best-effort basis. | Upward `AGENTS.md`/`CLAUDE.md` discovery follows the workspace. Outside the project root, only global instructions load.                                                               | Current location is implicit. External paths are path-based. No alias list is documented.                                     |
| Gemini CLI                | `--include-directories`, `/directory add <path>`, and `/directory show`.                                                        | Current cwd is the starting directory. Included directories join multi-directory workspace context.                                                           | `/directory add` is disabled in restrictive sandbox profiles. Launch-time `--include-directories` remains available. Exact file operations depend on sandbox and approval settings. [^gemini-commands]      | `context.loadMemoryFromIncludeDirectories` controls `/memory reload`. It scans included directories for `GEMINI.md` only when enabled. The default is `false`. [^gemini-configuration] | Explicit included directory paths. Docs do not define custom aliases.                                                         |
| oh-my-pi                  | Repeatable `--add-dir`, `/add-dir`, `/remove-dir`, `/dirs`, `workspace.additionalDirectories`, and SDK `additionalDirectories`. | `cwd` remains primary and the relative-path base. Additional roots are ordered normalized absolute paths. They persist across session reopen, fork, and move. | Prompt advertises `read`/`grep`/`glob`/`edit` for added paths. Root membership adds no distinct permission layer. Existing tool policies still apply.                                                       | Project context discovery runs for every additional root. It includes AGENTS.md/rules and adds AGENTS.md paths to directory context.                                                   | Absolute paths in `<workspace-roots>`. Prompt refreshes after add/remove. No alias mechanism.                                 |

## Tool findings

### Claude Code

Claude Code distinguishes its primary working directory from additional directories. The primary directory is where the session starts, until `/cd` moves it. `--add-dir`, `/add-dir`, and `additionalDirectories` extend access without changing that primary identity. Its permission docs classify file reads as allowed within the working and additional directories. Edits remain subject to tool permission mode. Bash is a separate capability and should not be equated with file-tool access. [^claude-permissions]

`CLAUDE.md` discovery follows the current directory and its ancestors, with nested files discovered as the agent works in those subdirectories. Files under additional directories are excluded by default. `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` opts into loading memory and rule files from each additional directory. This opt-in is important for repositories that expect their own instructions to accompany their source. [^claude-memory]

The current docs also describe `additionalDirectories` in settings and SDK configuration. This is a first-party filesystem grant, not evidence of an extra named project model. The model can be told where an added path is, but there is no documented alias field that renames it. [^claude-permissions][^claude-memory]

### Codex CLI

Codex CLI's `--add-dir` is a launch option for granting access to an extra directory. In `workspace-write`, Codex restricts writes to the workspace and writable roots. The official sandbox page describes the `workspace-write` model. The CLI reference describes the additional directory option. Therefore, `--add-dir` extends the workspace boundary without changing `cwd`. [^codex-cli-reference][^codex-sandbox]

The current official pages retrieved for this study did not establish whether Codex reads `AGENTS.md` from every `--add-dir` path, or how those roots are named in the model prompt. Do not infer either behavior from filesystem access alone. Codex's complete effective writable roots can also depend on configuration, so command-line flags alone are not a universal permissions statement. [^codex-cli-reference][^codex-sandbox]

### VS Code and Cursor

VS Code's `.code-workspace` stores an array of folder paths. Each folder can have a custom display `name`. Relative paths resolve from the workspace file. It supports settings at user, workspace, and folder scope. In multi-root mode, only resource settings are meaningful per-folder. Global editor settings belong to workspace settings. This is an editor model with visible root identities, not an agent authorization contract. [^vscode-multi-root]

Cursor uses the same `.code-workspace` multi-root organization. Cursor's AI context tools also let a user select files and folders explicitly with `@Files & Folders`. These documented surfaces do not prove that an Agent automatically reads all folders' instruction files or that every editor root is writable by the agent. [^vscode-multi-root][^cursor-files]

### Zed

Zed currently distinguishes a window containing several projects from a project containing several folder roots. Each project has its own file tree, git state, search scope, and project-bound agent threads. The UI can also add folders to a current project, which Zed describes as similar to VS Code multi-root. [^zed-projects]

Zed Agent supports a primary project instruction file selected from recognized conventions, including AGENTS.md and CLAUDE.md. The instructions docs do not establish automatic discovery from every extra root. Do not infer authorization from the editor's root display. [^zed-instructions]

### OpenCode

OpenCode's active Location is a root for relative path resolution. A path outside the active Location and its project worktree invokes the `external_directory` permission check before read or edit rules. Its defaults allow external directories, so users who need a deny-by-default boundary must configure one. Shell authorization uses scanner-inferred directories and is explicitly best-effort. [^opencode-permissions]

OpenCode loads global instructions and instruction files from the active workspace toward the project root. If the workspace is outside the project root, only global instructions load. Its docs describe changing the instruction state when the active location changes, but do not describe a named multi-root workspace passed to the model. [^opencode-permissions][^opencode-instructions]

### Gemini CLI

Gemini CLI supports included directories at launch with `--include-directories`. In restrictive sandbox profiles, `/directory add` is disabled, but the launch-time option remains available. [^gemini-commands]

The configuration reference sets `context.loadMemoryFromIncludeDirectories` to `false` by default. When enabled, `/memory reload` scans included directories for `GEMINI.md`. The docs do not establish root aliases in model-visible context. [^gemini-configuration]

### oh-my-pi

oh-my-pi exposes launch-time and in-session root management. Its `cwd` stays primary, while the ordered absolute root list persists across session reopen, fork, and move. [^omp-pr][^omp-workspace][^omp-command][^omp-cli][^omp-settings]

The prompt directs the model to use absolute paths under added roots with `read`, `grep`, `glob`, and `edit`. Root membership is not itself a new per-root permission policy. It does not create an OS sandbox or separate read/write authorization. Existing tool gates and process authority still apply. Isolated subagent worktrees explicitly clear additional roots to avoid carrying paths outside their isolated worktree. [^omp-prompt][^omp-subagents]

Project context discovery includes context files from additional roots, including `AGENTS.md` and agent rules. Workspace-tree discovery also returns added roots' `AGENTS.md` paths for directory-context guidance. [^omp-context][^omp-tree]

The `<workspace-roots>` block lists the added roots as absolute paths, with no friendly alias. `/add-dir` and `/remove-dir` rebuild the base system prompt, so the next model turn receives the updated set rather than relying on stale prompt context. The block describes current roots as authoritative over earlier workspace changes in conversation history. [^omp-prompt][^omp-command]

### Hub and spoke checkouts

A hub-and-spokes manifest separates repository topology from an editor or agent's workspace model. Zephyr `west` manifests name projects, assign each a path within the workspace, and update repositories at those paths. West supports a star where the manifest repo is the hub, and a forest where a separate manifest repo lists sibling projects. [^west-workspaces]

West's workspace documentation explicitly says projects may be located anywhere inside the workspace, but may not escape it. The manifest's `path` chooses each project location. This can provide stable spoke paths such as `checkouts/api`, without making the hub Git tree own the spoke contents. [^west-workspaces]

Git worktrees share the repository's object store. Each worktree has its own index and checked-out files. An ignored nested repository is not part of the hub commit. A new hub worktree needs the spoke checkout recreated at its declared path, or it must reference a checkout outside that worktree. **Inference:** an ignored nested clone is not portable across hub worktrees unless a setup step reproduces it. [^git-worktree][^west-workspaces]

For multi-root products, a robust flow is therefore: materialize spokes via the manifest for each worktree, then add those actual paths to the IDE or agent context, and grant permissions independently. A stored relative path like `checkouts/api` is portable only if each checkout materializes the same layout beneath the correct hub worktree.

## Cross-cutting conclusions

- A root list answers location membership, not authorization, instructions, or prompt representation. Each must be specified separately.
- A primary root may affect cwd-relative paths, project configuration, instruction discovery, and project-level trust even when additional roots are readable.
- Folder aliases improve human disambiguation. The VS Code `.code-workspace` sources reviewed explicitly define a custom visible folder `name`. Model-facing naming remains underdocumented for most CLIs.
- Permission boundaries should be reported per tool. Read, edit, shell, and subprocess access can have different rules.
- For hub-spoke repositories, filesystem provisioning belongs to manifest/workspace tooling. Agent multi-root support does not clone repos or restore ignored paths in worktrees.

[^git-worktree]: [Git worktree documentation, version 2.56.0](https://git-scm.com/docs/git-worktree/2.56.0) states that linked worktrees share repository data except per-worktree files such as `HEAD` and `index`.

## Sources

The vendor documentation cited here uses live URLs and does not provide versioned snapshots. Claims from those pages describe current documentation, not immutable release behavior.

[^claude-permissions]: [Claude Code permissions](https://code.claude.com/docs/en/permissions) describes working directories, file-tool access, permission modes, and additional directories.

[^claude-memory]: [Claude Code memory](https://code.claude.com/docs/en/claude-md) describes `CLAUDE.md` discovery, additional directories, and `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`.

[^codex-cli-reference]: [Codex CLI reference](https://developers.openai.com/codex/cli/reference) documents CLI flags including `--add-dir`.

[^codex-sandbox]: [Codex sandbox](https://developers.openai.com/codex/sandboxing) describes `workspace-write` and filesystem boundaries.

[^vscode-multi-root]: [VS Code multi-root workspaces](https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces) documents `.code-workspace`, paths, names, and folder settings.

[^cursor-files]: [Cursor @Files & Folders](https://docs.cursor.com/context/@-symbols/@-files-and-folders) documents explicitly including files and folders in AI context.

[^zed-projects]: [Zed Windows & Projects](https://zed.dev/docs/windows-and-projects) describes multiple projects per window and multiple folders in one project.

[^zed-instructions]: [Zed instructions](https://zed.dev/docs/ai/instructions) describes project instruction file selection and scope.

[^opencode-permissions]: [OpenCode permissions](https://opencode.ai/docs/permissions) documents location-relative and external-directory rules.

[^opencode-instructions]: [OpenCode instructions](https://opencode.ai/docs/instructions) documents upward instruction discovery and updates.

[^gemini-commands]: [Gemini CLI commands](https://geminicli.com/docs/reference/commands) documents `/directory add` and directory listing.

[^gemini-configuration]: [Gemini CLI configuration](https://geminicli.com/docs/reference/configuration) documents settings scope and sandbox configuration.

[^west-workspaces]: [West workspaces](https://docs.zephyrproject.org/latest/develop/west/workspaces.html) describes project locations, manifest topologies, and worktree-like update behavior.

[^omp-pr]: [Merged PR #6255](https://github.com/can1357/oh-my-pi/pull/6255) describes added root CLI flags, slash commands, settings, session persistence, and live prompt updates. Merge commit is `26726fdcb91cbacdd40e25dad60a1ba05552a898`.

[^omp-workspace]: [`session-workspace.ts`](https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/session/session-workspace.ts) normalizes `cwd` and additional roots as an ordered deduplicated list of absolute paths.

[^omp-prompt]: [`project-prompt.md`](https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/prompts/system/project-prompt.md) renders roots in `<workspace-roots>` and instructs path-based file-tool use.

[^omp-command]: [`builtin-registry.ts`](https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/slash-commands/builtin-registry.ts) implements `/add-dir`, `/remove-dir`, and `/dirs`, including prompt refresh after mutation.

[^omp-context]: [`system-prompt.ts`](https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/system-prompt.ts) loads project context and workspace-tree information from each added root.

[^omp-tree]: [`workspace-tree.ts`](https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/workspace-tree.ts) returns discovered `AGENTS.md` paths with the workspace tree.

[^omp-cli]: [`main.ts`](https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/main.ts) combines repeatable CLI roots and setting-provided roots for session creation.

[^omp-settings]: [`settings-schema.ts`](https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/config/settings-schema.ts) defines `workspace.additionalDirectories`.

[^omp-subagents]: [`executor.ts`](https://github.com/can1357/oh-my-pi/blob/d8816b454fa2054b6717d763b69997680b8e9908/packages/coding-agent/src/task/executor.ts) clears additional roots for isolated worktree subagents and forwards them for non-isolated subagents.
