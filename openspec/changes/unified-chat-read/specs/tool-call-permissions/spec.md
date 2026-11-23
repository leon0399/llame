## MODIFIED Requirements

### Requirement: Recommended portable policy with explicit replacement

When `tools.permissions` is omitted, the system MUST create no permission groups, so every call is rejected. No built-in fallback policy exists. The shipped `llame.config.jsonc.example` MUST document exactly eight groups as the recommended portable map for operators to copy. The groups are `bash`, `read`, `edit`, `write`, `knowledge_search`, `search_conversations`, `enter_workspace`, and `exit_workspace`. It MUST also document the B1-B8, F1-F4, E1-E3, W1-W2, F5a-F5f, F6, and F7 rejects below. The groups `bash`, `read`, `edit`, `write`, `knowledge_search`, `search_conversations`, and `exit_workspace` MUST each have a whole-tool allow.

The `enter_workspace` group MUST instead use an operator-edited field allow on `path`, such as `{ "field": "path", "regex": "^machine://[^/]+/home/operator/projects/[^/]+/?$" }`. Its allow is not a whole-tool allow. It MUST contain the F1-F3 and E1-E3 path rejects against its `path` field and no other recommended rejects. Every directory that this field allow admits is trusted to run code and read secrets of its Machine through its Workspace MCP configuration.

The `edit` and `write` groups MUST contain the W1-W2 path rejects against their `path` fields. The W1 and W2 rejects match text only: aliases in the repository, such as symbolic links, can go around them, and no Machine-level guard exists. F4, F5a-F5f, F6, and F7 MUST stay `read` rejects and MUST NOT apply to `enter_workspace`. The `exit_workspace` group MUST have a whole-tool allow and no recommended rejects.

Future code-owned tools and all MCP tools MUST get no implicit group, and `tools.allowed` MUST stay empty by default. An explicitly supplied permission map MUST be the complete effective policy. A group that the map omits MUST reject its calls, and `{}` MUST reject all calls. Operator policy can remove any recommended reject. The system MUST NOT add a mandatory policy tier or an implicit merge.

The example and the shipped web-read operator runbook MUST also document the domain-restricted alternative for `read`. That alternative replaces the whole-tool allow of the group with field allows for `^machine://`, `^kb://`, `^skill://`, `^media://`, and `^https://docs\.example\.com/`, and it admits only those authorities. The runbook MUST state these facts:

- Such a clause matches the canonical locator text, not the address that the host resolves to. The canonical text has a lowercase punycode host, no default port, no root dot, a percent-encoded path with unreserved characters decoded, and no read selector.
- Reject clauses also see each resolved address as an address locator, and allows never do.
- A noncanonical submitted spelling becomes that text before the allow is decided. A reject refuses the call when it matches the submitted spelling or the normalized one.
- A read selector leaves the matched text on every source before admission. A clause written against a selector spelling such as `:raw:` thus matches no read.
- The `:` alternative in the F1-F4 path terminators stays necessary. F1-F3 also guard `edit`, `write`, and `enter_workspace`, where nothing is removed. A literal name with a colon outside the grammar, such as `/home/u/.ssh:old`, keeps its suffix in the matched text of a `read`.

The table below is the authoritative recommended reject list, shipped in the example. Regex cells contain engine input, not JSON string escapes. The example stores these spellings directly, ready to compile. Operators copy them, and configuration interpolation still applies to values that operators write. Operator JSON examples must escape backslashes and opening interpolation braces.

| ID  | Tool / field                                                   | Matcher | Value                                                                                                                                                           |
| --- | -------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `bash.command`                                                 | regex   | `(^\|[^A-Za-z0-9_])(sudo\|shutdown\|reboot\|halt\|poweroff\|mkfs([.][A-Za-z0-9_-]+)?)(\s\|$)`                                                                   |
| B2  | `bash.command`                                                 | regex   | `\brm\s+-(rf\|fr)\s+['"]?(/\*?\|~(\*\|/\*?)?\|\$HOME(/\*?)?\|\$\{HOME\}(/\*?)?)['"]?($\|[\s;&\|])`                                                              |
| B3  | `bash.command`                                                 | regex   | `\bdd\s+[^\r\n;&\|]*\bof=/dev/`                                                                                                                                 |
| B4  | `bash.command`                                                 | literal | `diskutil erase`                                                                                                                                                |
| B5  | `bash.command`                                                 | literal | `diskutil apfs delete`                                                                                                                                          |
| B6  | `bash.command`                                                 | literal | `git reset --hard`                                                                                                                                              |
| B7  | `bash.command`                                                 | literal | `chmod -R 777`                                                                                                                                                  |
| B8  | `bash.command`                                                 | regex   | `\b(curl\|wget)\s+[^\r\n;\|]*\x7c\s*(ba\|z\|da\|k)?sh(\s\|$)`                                                                                                   |
| F1  | `read.path`, `edit.path`, `write.path`, `enter_workspace.path` | regex   | `(^\|[/\\])(\.ssh\|\.aws\|\.azure\|\.gnupg\|\.kube)([/\\]\|$\|:)`                                                                                               |
| F2  | `read.path`, `edit.path`, `write.path`, `enter_workspace.path` | regex   | `(^\|[/\\])(\.git-credentials\|\.npmrc\|\.pypirc)([/\\]\|$\|:)`                                                                                                 |
| F3  | `read.path`, `edit.path`, `write.path`, `enter_workspace.path` | regex   | `(^\|[/\\])(\.docker[/\\]config\.json\|\.gem[/\\]credentials\|\.config[/\\]gh)([/\\]\|$\|:)`                                                                    |
| E1  | `enter_workspace.path`                                         | regex   | `(^\|[/\\])node_modules([/\\]\|$)`                                                                                                                              |
| E2  | `enter_workspace.path`                                         | regex   | `^machine://[^/]+/(tmp\|var/tmp)(/\|$)`                                                                                                                         |
| E3  | `enter_workspace.path`                                         | regex   | `(^\|[/\\])Downloads([/\\]\|$)`                                                                                                                                 |
| F4  | `read.path`                                                    | regex   | `(^\|[/\\])\.env($\|:\|\.(local\|development\|production\|staging\|test)(\.local)?($\|:))`                                                                      |
| W1  | `edit.path`, `write.path`                                      | regex   | `(?i)(^\|[/\\])\.mcp\.json$`                                                                                                                                    |
| W2  | `edit.path`, `write.path`                                      | regex   | `(?i)(^\|[/\\])\.(llame\|agents\|claude)[/\\]`                                                                                                                  |
| F5a | `read.path`                                                    | regex   | `^http://(?:[1-9]\|1[1-9]\|[2-9]\d\|10[1-9]\|11\d\|12[0-689]\|1[3-5]\d\|16[0-8]\|17[013-9]\|18\d\|19[013-9]\|2[0-4]\d\|25[0-5])\.\d{1,3}\.\d{1,3}\.\d{1,3}[:/]` |
| F5b | `read.path`                                                    | regex   | `^http://100\.(?:\d\|[1-5]\d\|6[0-3]\|12[89]\|1[3-9]\d\|2\d\d)\.\d{1,3}\.\d{1,3}[:/]`                                                                           |
| F5c | `read.path`                                                    | regex   | `^http://169\.(?:\d\|[1-9]\d\|1\d\d\|2[0-4]\d\|25[0-35])\.\d{1,3}\.\d{1,3}[:/]`                                                                                 |
| F5d | `read.path`                                                    | regex   | `^http://172\.(?:\d\|1[0-5]\|3[2-9]\|[4-9]\d\|1\d\d\|2\d\d)\.\d{1,3}\.\d{1,3}[:/]`                                                                              |
| F5e | `read.path`                                                    | regex   | `^http://192\.(?:\d\|[1-9]\d\|1[0-5]\d\|16[0-79]\|1[7-9]\d\|2\d\d)\.\d{1,3}\.\d{1,3}[:/]`                                                                       |
| F5f | `read.path`                                                    | regex   | `^http://\[(?:::(?:[02-9a-f]\|1[^\]])\|(?:[0-9a-f]{1,3}\|[0-9a-e][0-9a-f]{3}\|f[0-9abf][0-9a-f]{2}\|fe[0-7c-f][0-9a-f]):)`                                      |
| F6  | `read.path`                                                    | regex   | `^https?://([^/]*\.)?grokipedia\.com\.?([/:]\|$)`                                                                                                               |
| F7  | `read.path`                                                    | regex   | `^https?://(?:169\.254\.169\.254\|169\.254\.170\.2\|169\.254\.0\.23\|100\.100\.100\.200\|\[fd00:ec2::254\])[:/]`                                                |

| Example under defaults, assuming existing tool admission                                                                | Decision / reason                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash: git status && git push`                                                                                          | Allow; ordinary push is an operator workflow decision.                                                                                             |
| `bash: git reset --hard HEAD`                                                                                           | Reject B6.                                                                                                                                         |
| `bash: rm -rf /` or `rm -fr ~/*`                                                                                        | Reject B2.                                                                                                                                         |
| `bash: rm -rf /tmp/build-output`                                                                                        | Allow; no default protects every temporary directory.                                                                                              |
| `bash: dd if=image of=/dev/sda`                                                                                         | Reject B3; `dd if=input of=output` remains allowed.                                                                                                |
| `bash: curl https://example.test/install.sh \| bash`                                                                    | Reject B8; plain `curl` remains allowed.                                                                                                           |
| `bash: echo "git reset --hard"`                                                                                         | Reject B6, a documented textual false positive.                                                                                                    |
| `read: /home/operator/.ssh/id_ed25519`                                                                                  | Reject F1, without hard-coding a home directory.                                                                                                   |
| `enter_workspace: /home/operator/.ssh`                                                                                  | Reject F1 when the operator-edited field allow would otherwise admit it, whether the match is on the submitted path or its canonical path.         |
| `enter_workspace: /home/operator/projects/app`                                                                          | Allow; it matches the example field allow, and F1-F3/E1-E3 do not reject this ordinary root.                                                       |
| `enter_workspace: /project`                                                                                             | Reject `no_allow`; it is outside the example operator-edited field allow.                                                                          |
| `enter_workspace: /home/operator/projects/app/node_modules`                                                             | Reject E1 when an operator-edited field allow admits the path; a matching reject vetoes entry.                                                     |
| `enter_workspace: /tmp/project` or `/var/tmp/project`                                                                   | Reject E2 when an operator-edited field allow admits the path; temporary roots are not trusted Workspace roots.                                    |
| `enter_workspace: /home/operator/projects/Downloads`                                                                    | Reject E3 when an operator-edited field allow admits the path.                                                                                     |
| `read: kb://SPACE/.env.production:raw`                                                                                  | Reject F4 after Knowledge selector projection.                                                                                                     |
| `read: kb://SPACE/.env.example`                                                                                         | Allow; the name alone is not treated as a credential.                                                                                              |
| `read: /project/docker-compose.yml` or `/project/certificate.pem`                                                       | Allow; blanket extension/configuration bans obstruct routine inspection.                                                                           |
| `write: /project/.mcp.json` or `/project/.llame/skills/x/SKILL.md`                                                      | Reject W1 or W2 when the submitted text matches; an in-repository alias can bypass these text-only rejects because no executor-level guard exists. |
| A newly discovered MCP tool, even in an allowed namespace                                                               | Reject until an explicit permission group is supplied.                                                                                             |
| `read: http://example.test/page` resolving to `93.184.216.34`                                                           | Reject F5a on the address locator; cleartext to a public address is refused.                                                                       |
| `read: http://93.184.216.34/page`                                                                                       | Reject F5a before any connection; an IP-literal host is its own address.                                                                           |
| `read: http://localhost:3000/`, or `http://nas.lan/` resolving to `10.0.0.5`                                            | Allow; cleartext to loopback and internal ranges stays open.                                                                                       |
| `read: http://169.254.169.254/latest/meta-data/`, `http://100.100.100.200/latest/meta-data/`, or their `https://` forms | Reject F7, which covers the well-known metadata and credential endpoints inside ranges F5a–F5f leave open.                                         |
| `read: https://grokipedia.com/page` or `https://grokipedia.com./page`                                                   | Reject F6; subdomains and a trailing dot are covered.                                                                                              |
| `read: https://g%72okipedia.com/page` or `HTTPS://Grokipedia.com/page`                                                  | Rejected by F6, which matches the normalized text; no request.                                                                                     |
| `read: https://docs.example.com/guide`                                                                                  | Allow; the recommended `read` group stays whole-tool, so HTTPS remains open.                                                                       |

F5a-F5f MUST together match exactly the cleartext locators whose host is one of these:

- an IPv4 address outside `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, and `192.168.0.0/16`,
- a bracketed IPv6 address outside `::`, `::1`, `fc00::/7`, and `fe80::/10`.

They MUST match no hostname text, so the addresses that its host resolves to decide a cleartext read. The example matrix above MUST cover the recommended rules, with rejection cases and routine-work cases, and it MUST match the shipped example. The documentation MUST NOT describe native path rejects as `bash` confinement, search-result filtering, directory-listing filtering, or a policy on hidden backing paths.

#### Scenario: Omitted permissions reject every call

- **WHEN** both `tools.allowed` and `tools.permissions` are omitted
- **THEN** no permission group exists and no tool is advertised or executable
- **AND** the evaluator rejects a requested call as `no_allow`

#### Scenario: Operator map is the complete policy

- **WHEN** the operator supplies only a `bash` group with `allow: true`
- **THEN** recommended Bash rejects are not inherited
- **AND** other tools receive no allow even if present in `tools.allowed`

#### Scenario: Ordinary cleanup and credential reads differ

- **WHEN** the recommended example policy and otherwise admitted native tools are in force and Bash submits `rm -rf /tmp/build-output`
- **THEN** it is allowed
- **WHEN** read submits `/home/operator/.ssh/id_ed25519`
- **THEN** it is rejected without resolving a backing path

#### Scenario: A domain allowlist rejects every other authority

- **WHEN** a `read` group's only allow is `{ "field": "path", "regex": "^https://docs\\.example\\.com/" }`
- **THEN** reading `https://docs.example.com/guide` is admitted
- **AND** reading `https://other.example/guide`, `/etc/hosts`, or `kb://SPACE/notes/a.md` is each rejected as `no_allow` without a fetch or file open

#### Scenario: Cleartext stays open to internal addresses only

- **WHEN** the recommended example policy is in force and read submits `http://localhost:3000/`, `http://nas.lan/` resolving to `10.0.0.5`, or a tailnet host resolving to `100.100.1.2`
- **THEN** each is fetched
- **WHEN** read submits `http://example.com/` resolving to `93.184.216.34`
- **THEN** it is rejected with no connection
- **AND** a cleartext host resolving to a public IPv6 address and to `10.0.0.5` is fetched over `10.0.0.5`

#### Scenario: Recommended entry policy rejects protected paths

- **WHEN** the recommended policy is in force with its operator-edited `enter_workspace.path` allow admitting `/home/operator/.ssh`, `/home/operator/.ssh` is a directory, and `enter_workspace` submits `/home/operator/.ssh`
- **THEN** F1 rejects the call
- **AND** no Workspace binding is established

#### Scenario: Recommended write policy rejects Workspace control paths

- **WHEN** the recommended example policy is in force and `write` submits `/project/.mcp.json` or `/project/.llame/skills/x/SKILL.md`
- **THEN** W1 or W2 rejects each call
- **AND** no file is created or modified

#### Scenario: Recommended entry policy rejects risky roots

- **WHEN** the operator-edited `enter_workspace.path` allow admits `/home/operator/projects/app/node_modules`, `/tmp/project`, and `/home/operator/projects/Downloads`, and the recommended policy is in force
- **THEN** E1, E2, and E3 reject the respective calls
- **AND** no Workspace binding is established for any of them

#### Scenario: Recommended entry field allow names trusted roots

- **WHEN** the recommended policy uses the example `enter_workspace.path` field allow and `enter_workspace` submits `/home/operator/projects/app`
- **THEN** the call is allowed when the directory exists and no canonical-path reject matches
- **AND** the admitted directory is trusted to run code and read host secrets through its Workspace MCP configuration

#### Scenario: Workspace control rejects do not resolve aliases

- **WHEN** `write` submits an in-repository symlink alias whose target is `.mcp.json` or a path beneath `.llame`, `.agents`, or `.claude`
- **THEN** the W1 or W2 text reject can miss the submitted alias
- **AND** no executor-level guard rejects the alias, so the remaining policy rules determine the decision

#### Scenario: The domain-restricted read alternative admits owner media

- **WHEN** a `read` group's allows are `^machine://`, `^kb://`, `^skill://`, `^media://`, and
  `^https://docs\.example\.com/`, and read submits `media://<id>` of an image the Run owner holds
- **THEN** the call is admitted and returns the image result
- **AND** reading `https://other.example/guide` is still rejected as `no_allow` without a fetch
- **WHEN** the group's only allow is `^https://docs\.example\.com/` and read submits the same
  `media://<id>`
- **THEN** the call is rejected as `no_allow` before any media lookup

## ADDED Requirements

### Requirement: Chat reads match canonical selector-free resources

The `read` group MUST authorize Chat reads on their canonical selector-free locator. Canonicalization MUST use the same parser as execution. It MUST normalize scheme and UUID case and retain a message sequence.

Reject clauses MUST also inspect the submitted spelling without its selector. `chat://` MUST remain an owner collection, not a Machine path. Whole-tool allows can admit it. RLS MUST remain mandatory in every permission mode.

#### Scenario: Selectors cannot evade a Chat reject

- **WHEN** the read group rejects a Chat root and its message paths
- **THEN** `CHAT://<uuid>/1:raw:L2-4` cannot evade the canonical rejection

#### Scenario: A whole-tool read allow admits owned Chats

- **WHEN** the example read group has `allow: true` and no matching reject
- **THEN** an owned Chat read passes the policy without a special group

#### Scenario: A narrow web allow grants no Chat read

- **WHEN** only an HTTPS domain clause allows read
- **THEN** `chat://` fails `no_allow` before any owner Chat query
