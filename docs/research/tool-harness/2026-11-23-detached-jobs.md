---
type: Research
title: "Jobs that outlive the Machine daemon"
description: "Compares process detachment, subreapers, pidfds, systemd transient units, tmux sessions and confinement interactions for background jobs that survive a Machine daemon restart."
tags:
  - background-jobs
  - machine-daemon
  - process-detach
  - systemd
  - sandbox
status: draft
summary: "The kernel never adopts a running job into a new parent, so a restarted daemon can watch a job but cannot reap it, and the exit status must reach disk through a wrapper. Holders that reparent the job (systemd units, tmux, a per-job runner) make it survive, and each holder has a different stop and confinement story."
read_when:
  - designing the daemon-hosted durability tier of background jobs
  - choosing how the Machine daemon stops or adopts a job after a restart
  - deciding whether systemd or tmux may be a Machine dependency
observed:
  date: 2026-11-23
  revisions:
    llame: 852b663d869897ac948f3e67dbbdc8028f54d07c
    codex: 22c1681aec46de3667e4b03786e9d2c9ae6e1066
    coder: v2.36.6
    shipyard: b140a0ffe8cd44ba4d410f3f100d1cc34acb6790
    openhands-terminal: 66af27073fb2838734574f33349761777c3b9e0d
    launchd: d448a1c8f70a61202f8705f94337f686b87c30c4
sources:
  - id: linux-pid-namespaces
    resource: "https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/refs/tags/man-pages-6.12/man/man7/pid_namespaces.7"
    title: "pid_namespaces(7): namespace init death, orphan adoption, subreapers"
  - id: linux-subreaper
    resource: "https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/refs/tags/man-pages-6.12/man/man2/prctl.2"
    title: "PR_SET_CHILD_SUBREAPER(2const): reparenting and reaping of orphans"
  - id: linux-pdeathsig
    resource: "https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/refs/tags/man-pages-6.12/man/man2/prctl.2"
    title: "PR_SET_PDEATHSIG(2const): parent-death signal, cleared by fork"
  - id: linux-daemon7
    resource: "https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/refs/tags/man-pages-6.12/man/man7/daemon.7"
    title: "daemon(7): SysV double fork, setsid, PID file race requirements"
  - id: linux-pidfd-open
    resource: "https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/refs/tags/man-pages-6.12/man/man2/pidfd_open.2"
    title: "pidfd_open(2): exit monitoring with poll, waitid only for children"
  - id: systemd-kill
    resource: "https://www.freedesktop.org/software/systemd/man/249/systemd.kill.html"
    title: "systemd.kill: KillMode=control-group default and SIGKILL escalation"
  - id: systemd-run
    resource: "https://www.freedesktop.org/software/systemd/man/249/systemd-run.html"
    title: "systemd-run: transient service has the service manager as parent"
  - id: systemd-unit
    resource: "https://www.freedesktop.org/software/systemd/man/249/systemd.unit.html"
    title: "systemd.unit: transient unit directories under /run and $XDG_RUNTIME_DIR"
  - id: systemd-service
    resource: "https://www.freedesktop.org/software/systemd/man/249/systemd.service.html"
    title: "systemd.service: Restart= supervision of new processes"
  - id: loginctl
    resource: "https://www.freedesktop.org/software/systemd/man/249/loginctl.html"
    title: "loginctl: enable-linger keeps a user manager after logout"
  - id: logind-conf
    resource: "https://www.freedesktop.org/software/systemd/man/249/logind.conf.html"
    title: "logind.conf: KillUserProcesses and user manager lifetime"
  - id: cgroup-v2
    resource: "https://docs.kernel.org/6.12/admin-guide/cgroup-v2.html"
    title: "cgroup v2: cgroup.kill kills a cgroup tree including new forks"
  - id: linux-landlock
    resource: "https://docs.kernel.org/6.12/userspace-api/landlock.html"
    title: "Landlock: domain inheritance by children and irreversibility"
  - id: bubblewrap
    resource: "https://github.com/containers/bubblewrap/blob/v0.6.1/bwrap.xml"
    title: "bubblewrap 0.6.1: pid 1 reaper, --die-with-parent, --as-pid-1"
  - id: tmux
    resource: "https://github.com/tmux/tmux/blob/3.2a/tmux.1"
    title: "tmux 3.2a: server and client processes, persistent sessions"
  - id: wsl-systemd
    resource: "https://github.com/MicrosoftDocs/WSL/blob/526e57752f7241dc7e98f14b1033905e8e675587/WSL/systemd.md"
    title: "WSL systemd support at the inspected commit"
  - id: claude-background
    resource: "https://code.claude.com/docs/en/interactive-mode"
    title: "Claude Code background Bash commands and cleanup at exit"
  - id: codex-app-server
    resource: "https://github.com/openai/codex/blob/22c1681aec46de3667e4b03786e9d2c9ae6e1066/codex-rs/app-server-protocol/src/protocol/common.rs"
    title: "Codex background terminal API at the inspected revision"
  - id: codex-process-manager
    resource: "https://github.com/openai/codex/blob/22c1681aec46de3667e4b03786e9d2c9ae6e1066/codex-rs/core/src/unified_exec/process_manager.rs"
    title: "Codex process store and exit watcher for background terminals"
  - id: shipyard-architecture
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/docs/concepts/architecture.mdx"
    title: "Shipyard berthd as user service, tmux sessions outlive daemon and app"
  - id: coder-reconnectingpty
    resource: "https://github.com/coder/coder/blob/v2.36.6/agent/reconnectingpty/server.go"
    title: "Coder agent reconnecting PTY server holds the process in the agent"
  - id: devpod-agent
    resource: "https://github.com/loft-sh/devpod/blob/5a0efcbff6610ab114b421f68a890739a452e66b/docs/pages/developing-providers/agent.mdx"
    title: "DevPod provider agent at the inspected commit"
  - id: openhands-terminal
    resource: "https://github.com/OpenHands/software-agent-sdk/blob/66af27073fb2838734574f33349761777c3b9e0d/openhands-tools/openhands/tools/terminal/README.md"
    title: "OpenHands terminal tool: tmux pane pool or subprocess PTY"
  - id: launchd-lifecycle
    resource: "https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html"
    title: "Creating Launch Daemons and Agents, document version 6.3.4"
  - id: llame-bash-spec
    resource: "../../../openspec/specs/bash-execution/spec.md"
    title: "bash execution spec: async refused on other Machines until jobs run there"
  - id: llame-daemon-serve
    resource: "https://github.com/leon0399/llame/blob/852b663d869897ac948f3e67dbbdc8028f54d07c/apps/machine/src/serve.ts"
    title: "Machine daemon session end waits for every process group it started"
  - id: llame-job-loss
    resource: "../../../apps/api/src/jobs/chat-jobs.repository.ts"
    title: "Jobs settle as lost when their worker heartbeat is dead"
---

# Jobs that outlive the Machine daemon

## Summary

**Finding (high confidence):** the Linux kernel never adopts a running process
into a new parent. A later daemon can discover a job it did not start and can
watch it exit, but it cannot wait on it. The exit status is available to the
job's parent only, so a job that must outlive its starter has to hand its
outcome to disk through a wrapper that the starter's death does not kill. [^linux-pid-namespaces][^linux-pidfd-open]

Survival therefore comes from **who becomes the parent**, not from any daemon
trick. A subreaper ancestor, a systemd unit, a tmux server or a per-job runner
all work by reparenting the job to a process that outlives the daemon. Each
holder differs in dependencies, stop behavior and confinement. [^linux-subreaper][^systemd-run][^tmux]

For daemon-hosted background jobs, a low-risk shape is a per-job runner that
owns the job, writes output and status files, and records an identity tuple.
The daemon can discover and watch the job only while the runner or another
holder keeps it alive. A systemd transient scope inherits the caller's
execution environment but does not record a main-process exit status. A
transient service and an existing tmux server do not inherit the caller's
Landlock or seccomp restrictions. The recommendation is an inference from the
study record, not a tested llame implementation.

## Machine daemon process lifecycle

The following repository behavior is pinned by `observed.revisions.llame`.

The Machine protocol had `proc.bash` and `proc.cancel` and no job methods. The
daemon ran a command through `bash-executor` with `detached: true`, so the
shell was a process-group leader that the daemon killed when the call aborted
(`packages/bash-executor/src/execute.ts`, `process-tree.ts`). [^llame-daemon-serve]

`endSession` closed the multiplexer and resolved only after
`session.processes.settled()`, which waited for every process group the session
started. A dropped SSH connection therefore stopped in-flight daemon commands
rather than orphaning them. [^llame-daemon-serve]

On the host, `apps/api/src/tools/bash-async-runtime.ts` and
`background-jobs` kept `chat_jobs` and `chat_job_chunks` rows in Postgres, and
the process that hosted a job wrote chunks and a settlement. The spec refused
`async` and `unlimited` on every Machine except `machines.local`, "until
background jobs run on every Machine". [^llame-bash-spec]

Job loss was already modelled. `worker_instances.last_seen_at` decayed, a worker
with no heartbeat for four intervals was dead, and the jobs of that worker settled
as `lost` with `outcomeUnknown: true` at the next touch. [^llame-job-loss] That
reporting shape was a candidate for a reboot as well.

## Process mechanics

### Double fork, setsid and reparenting

The classical SysV sequence is `fork`, `setsid`, `fork`, exit the first child,
then redirect the three standard descriptors. `setsid` leaves the controlling
terminal and creates a new session, and the second fork guarantees the job can
never reacquire a terminal. The first child's exit reparents the job to the
nearest ancestor that acts as init. [^linux-daemon7]

```text
$ ./exp detach /tmp/detached-exp/pid sh -c 'sleep 8; exit 7'
starter rc=0
$ cat pid
2256013
$ ./exp ppid 2256013
State:  R (running)
PPid:   2531
$ ps -o pid,ppid,pgid,sid,stat,cmd -p 2256013
  PID    PPID    PGID     SID STAT COMMAND
2256013  2531  2256012  2256012 S    sh -c sleep 8; exit 7
```

PID 1 on this box is `systemd`, yet the orphan's parent is 2531. That process
reports the name `Relay(2533)` and the command line `/init`, so it is the
nearest ancestor subreaper of the tool sandbox. It is not PID 1. The same code on a box without a subreaper reparents the job to
PID 1, as `daemon(7)` describes. [^linux-daemon7][^linux-subreaper]

The practical consequence for llame is that a job started by a daemon that
later exits does not become the child of anything llame controls. If the daemon
wants to reap its own jobs, the daemon or a per-job runner must be the parent
and must stay alive.

### Subreapers

A process can declare itself the reaper for orphaned descendants with
`prctl(PR_SET_CHILD_SUBREAPER, 1)`. Orphans then reparent to the nearest living
subreaper, `getppid` returns that process, and the subreaper reaps the child and
learns its status. The attribute is not inherited across `fork`, and it survives
`execve`. [^linux-subreaper]

```text
$ ./exp subreaper /tmp/detached-exp/sub.pid sh -c 'sleep 25' &
subreaper=2259868
$ cat sub.pid
2259870
$ ./exp ppid 2259870
PPid:   2259868
```

A daemon that is a subreaper while it lives keeps status collection for jobs
started in its lifetime. A restarted daemon cannot claim that role for a job
that already reparented, because the attribute is per process and the kernel
chose the parent already. A per-job runner makes the holder explicit and
survives a daemon restart, which a daemon-owned subreaper cannot.

### Parent-death signals

`PR_SET_PDEATHSIG` sends a signal to the calling process when its parent
thread dies. The setting is cleared for the child of a `fork`, and a
`SIGKILL` disposition is preserved across `execve`. [^linux-pdeathsig]

```text
mode=exec parent=2262508 child=2262509
--- parent killed ---
child 2262509 DIED with parent
...
sh alive: False
grandchild 2263264 alive: True
```

The second probe matters. A shell under a parent-death signal dies with the
daemon, and its own child survives because the signal is not inherited. A
parent-death signal therefore expresses "this call must not outlive the daemon",
and it cannot detach a job tree. The daemon's current refusal of daemon-held
jobs is closer to this behavior than to a durability tier.

### Finding and polling a job you did not start

`pidfd_open` returns a file descriptor for an existing process. `poll` reports
readable when the task exits, and the descriptor stays valid across a PID
reuse. `waitid` on that descriptor works only when the caller is the parent.
Opening a pidfd for a reaped process fails with `ESRCH`. [^linux-pidfd-open]

```text
$ ./exp waitprobe 2258819
waitid rc=-1 errno=10 (No child processes)
pidfd poll events: [(3, 1)] after 2.99s
waitid from non-parent: ChildProcessError: [Errno 10] No child processes
```

```text
job=2281901
ident while running: boot=e3b41f06-3fce-41db-9814-376773fcc558 starttime=28639786
pidfd_open after exit: ESRCH (reaped, pid may be reused)
liveness check via kill(pid, 0): ESRCH
```

A pid alone is not an identity. A later daemon must store at least the boot id
from `/proc/sys/kernel/random/boot_id` and the start time from field 22 of
`/proc/<pid>/stat`. The pidfd route works only if the job is still running when
the daemon starts, and PID namespaces require the numbers to be translated, as
the outer and inner `NSpid` values show. [^linux-pid-namespaces][^linux-pidfd-open]

### Recovering the exit status

Because only the parent can wait, the wrapper is the mechanism. The wrapper is
the job's parent and writes the status before it exits. A later daemon reads the
file and treats a missing file as "outcome unknown".

```text
$ ./exp detach pid record.sh status3 sh -c 'sleep 3; exit 7'
$ ./exp waitprobe $(cat pid)
waitid rc=-1 errno=10 (No child processes)
status now: MISSING
$ sleep 4; cat status3
7
```

The wrapper must not be the process the daemon kills at shutdown, and it must
not be inside a cgroup that the daemon's own stop kills. If the box dies, the
file is absent and the job is `lost`, which matches the existing `lost` state.

## systemd user units

`systemd-run --user` creates a transient unit. A transient service "will run in
a clean and detached execution environment, with the service manager as its
parent process", so the job survives the caller. A transient scope is executed
by `systemd-run` itself and returns only when the command finishes. The unit
still belongs to the manager, and in the scope probe below the command outlived
a killed client. [^systemd-run]

```text
$ systemd-run --user --unit=parent-probe2 sleep 30
$ M=$(systemctl --user show -p MainPID --value parent-probe2)
$ ps -o pid,ppid,args -p "$M"
  PID    PPID COMMAND
2286385   609 /nix/store/.../bin/sleep 30
$ ps -o pid,args -p 609
  609 /lib/systemd/systemd --user
```

The exit status is queryable after the fact, and `--remain-after-exit` keeps the
unit alive for the query. [^systemd-run][^systemd-service]

```text
$ systemd-run --user --unit=exit-probe --remain-after-exit sh -c 'exit 7'
$ systemctl --user show -p ActiveState -p Result -p ExecMainStatus exit-probe
ActiveState=failed
Result=exit-code
ExecMainStatus=7
```

A stop kills the whole control group by default, which is stronger than a
process-group signal. `KillMode=` defaults to `control-group`, and `SIGKILL`
follows `SIGTERM` after `TimeoutStopSec=`. [^systemd-kill]

```text
$ systemd-run --user --unit=detach-research-svc2 bash -c 'setsid sleep 331 & sleep 332'
$ systemctl --user stop detach-research-svc2
all gone (escaped setsid child included)
```

The scope case behaves the same for stop. It survives the `systemd-run` client
dying, because the unit belongs to the manager, and its stop kills both the
grouped and the escaped child.

```text
client=2266165
after client SIGKILL: scope=active
2266166 sleep 341
2266167 sleep 342
--- stop scope ---
all gone
```

Transient units are runtime state. Their unit files live in
`$XDG_RUNTIME_DIR/systemd/transient` or `/run/systemd/transient`, which are
tmpfs, so a reboot removes them. [^systemd-unit]

```text
$ ls /run/user/1000/systemd/transient
transient-path-probe.service
$ findmnt -no TARGET,FSTYPE /run/user/1000
/run/user/1000 tmpfs
```

Availability is the weak point. `systemd-run --user` needs a running user
manager and its bus, and an empty environment fails loudly.

```text
$ env -i HOME=$HOME systemd-run --user --unit=noenv-probe sleep 1
Failed to connect to bus: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined
```

On this WSL2 box systemd 249 runs, the user manager is running, and
`Linger=no`. The user manager exists because a session does, and
`enable-linger` is what keeps it, and its units, alive after the last logout.
`KillUserProcesses=` decides whether the user's processes die when the last
session ends, except when lingering is enabled. [^loginctl][^logind-conf]

WSL2 needs systemd enabled with `[boot] systemd=true` and a new enough WSL, and
the current Ubuntu default enables it. Inside a container there is no user
manager unless the image runs systemd and logind, so a daemon that depends on
systemd units works on bare Metal and WSL hosts and fails in most containers.
[^wsl-systemd]

## tmux and screen as the holder

tmux keeps sessions in a server process and connects clients over a socket.
"Each session is persistent and will survive accidental disconnection ... or
intentional detaching", and once all sessions are killed the server exits.
[^tmux]

```text
$ tmux -L detachprobe new-session -d -s job 'sh -c "echo started; sleep 62"'
server pid: 2270553   (PPid 2531)
pane pid=2270554
--- kill tmux server (simulates holder crash) ---
pane died with server
```

tmux records a pane's exit status while the dead pane is retained. Shipyard
uses this shape, with `berthd` as a user service and agent CLIs in tmux
sessions that "outlive the daemon and the app". [^tmux][^shipyard-architecture]

```text
$ tmux -L statusprobe new-session -d -s s1 "sh -c 'sleep 0.3; exit 7'" \; set-option -g remain-on-exit on
$ tmux -L statusprobe display -p -t s1 '#{pane_dead} status=#{pane_dead_status}'
1 status=7
```

The holder is still a process in the user's session and cgroup. A user manager
stop, a login teardown with lingering off, or a container stop takes tmux and
every job in it. tmux adds a dependency the daemon cannot assume on servers and
in containers, and its screen-oriented model fits interactive CLIs better than
machine-written jobs.

## Output files and byte offsets

Files are the only output channel that survives the daemon, the holder and the
connection. A reader opens the file, seeks to a stored offset, and reads. The
evidence below shows a partial read mid-run, then the next increment, then an
empty read at EOF.

```text
size=12 offset=0 new_bytes=12 content=b'line1\nline2\n'
size=18 offset=12 new_bytes=6 content=b'line3\n'
size=24 offset=18 new_bytes=6 content=b'line4\n'
size=24 offset=24 new_bytes=0 content=b''
```

Two rules follow. A reader must treat a line as complete only after a newline,
because a writer can be killed mid-line. A reader must also compare both the
stored file identity and offset with `st_size`. A replacement can be larger than
the old offset, so size alone cannot detect it.

```text
stored offset 10 size 0 -> truncation detected: True
```

The existing job store at the inspected revision did not reason in byte
positions. `appendJobOutput` slices accumulated output with JavaScript string
indices, which are UTF-16 code-unit offsets, and stores that position in a
`chat_job_chunks` row. A file reader must keep code-unit positions separate
from byte offsets or convert them against the corresponding text. Byte counts
are used for quota calculation. Bounded output means the reader also has to
cap and rotate, as `output-bound.ts` does for the tool path.

## Stopping an adopted tree

A stop must kill every process the job created, including children that left
the process group. A `setsid` child escapes a process-group signal, as this
probe shows. Only the grouped sleep dies.

```text
leader=2265124 pgid=2265124 sid=2265124 bash -c 'sleep 324 & setsid sleep 325 & wait'
2265126 2265124 2265124 sleep 324
2265127 2265127 2265127 sleep 325
--- kill -KILL -2265124 ---
2265127 2265127 2265127 sleep 325
```

Stopping a job the daemon adopted works on the group when nothing escaped. The
group id and sid survive the starter's death, so `kill -TERM -$PGID` and then
`kill -KILL -$PGID` reach the group.

```text
job=2284579 pgid=2284575
2284579 2531 2284575 sh -c 'sleep 100 & sleep 100'
--- kill -KILL -2284575 ---
group gone
```

For a complete stop there are four options, in increasing strength:

1. Signal the process group, which misses `setsid` and `setpgid` escapees.
2. Walk `/proc` descendants and signal each one, which races with forks and
   cannot see a process that already reparented away.
3. Kill the job's cgroup. `cgroup.kill` kills the cgroup and all descendants and
   handles concurrent forks, which is why the systemd stop above caught the
   escaped child. [^cgroup-v2]
4. Kill the job's PID namespace init, which makes the kernel kill every member.
   This is all-or-nothing and it also ends the only route to a clean status.

A cgroup stop needs the job to live in its own cgroup. A daemon that runs as a
systemd service and lets jobs inherit its cgroup cannot use its own unit stop
for this, because stopping the unit would kill the jobs. Each job needs its own
transient unit or a delegated cgroup. [Inference, moderate confidence]

## Confinement

A Landlock domain is inherited by children and cannot be removed once the
thread is landlocked. [^linux-landlock] The probe installs a ruleset that allows
reads anywhere and writes only under `/tmp/detached-exp`, then runs a shell. The
write outside the allowed tree is refused, and the read of `/etc/hostname`
still works.

```text
$ ./exp landlock /tmp/detached-exp sh -c 'echo ok > /tmp/detached-exp/inside.txt; echo bad > /tmp/blocked.txt; cat /etc/hostname; grep Seccomp /proc/self/status'
sh: line 1: /tmp/blocked.txt: Permission denied
lmeleshin-nb
Seccomp: 2
rc=0
inside=ok blocked=original
```

A detached job keeps that domain after its starter exits. The job below was
started with the same ruleset, the starter returned at once, and the job's write
was still refused.

```text
$ ./exp detach pid4 ./exp landlock /tmp/detached-exp sh -c 'sleep 2; echo attempt > /tmp/blocked.txt; echo done-$?'
$ cat job.out
sh: line 1: /tmp/blocked.txt: Permission denied
done-1
$ cat /tmp/blocked.txt
original
```

Seccomp filters stack and are inherited across `fork` and `execve`, and no
interface removes one. The probe adds a filter that returns `EPERM` for
`getuid` and `geteuid`, and the count shows the filter still present after the
double fork and `setsid`.

```text
$ ./exp seccomp sh -c 'id -u; grep Seccomp_filters /proc/self/status'
4294967295
Seccomp_filters: 2
$ ./exp detach pid6 ./exp seccomp sh -c 'sleep 2; id -u; grep Seccomp_filters /proc/self/status'
job.out:
4294967295
Seccomp_filters: 2
```

So confinement does not leak when a job is detached directly from the confined
process. The job carries that process's Landlock domain and seccomp filters.
This does not apply to launchers that create the job outside that process.

First, a Landlock domain can restrict signals as well as files. A same-user
process can stop the job only when the ruleset does not constrain that signal
scope. [^linux-landlock]

Second, a bubblewrap PID namespace is a hard boundary around liveness, not just
access. `bwrap` runs a minimal pid 1 in the sandbox, and "the pid 1 process exits
to clean up the sandbox when there are no other processes in the sandbox left".
The kernel then kills every member of the namespace when that init exits.
[^bubblewrap][^linux-pid-namespaces]

```text
$ bwrap --unshare-pid --dev-bind / / --proc /proc sh -c 'echo inner=$$; sleep 60 & wait'
inner=2
$ awk '/^NSpid/{print}' /proc/2266476/status
NSpid: 2266476 3
$ kill -9 2266473      # outer bwrap supervisor
$ pgrep -af 'sleep 60'
2266476 sleep 60       # still alive
$ kill -9 2266474      # the namespace init
whole namespace killed when PID 1 exited
```

The outer `bwrap` process is not the namespace init. Killing it leaves the
sandbox and the job alive, and only the inner init's death ends everything. A
per-job namespace therefore gives a perfect stop and a fatal coupling at once,
because the namespace also dies with its init on daemon exit.

`--die-with-parent` changes that coupling in the other direction. It "kills
(SIGKILL) all bwrap sandbox processes in sequence from parent to child
including COMMAND process when bwrap or bwrap's parent dies". [^bubblewrap]

```text
mode=plain caller=2269735 bwrap=2269736 inner=['2269739']
bwrap alive: True
inner alive: ['2269739']
mode=die caller=2269800 bwrap=2269801 inner=['2269804']
bwrap alive: False
inner alive: []
```

For a durable job the plain form (no `--die-with-parent`) is right, and the PID
namespace must live as long as the job's holder. A namespace per job is
compatible with a per-job runner, because the runner can own the bwrap process
instead of the daemon. `--as-pid-1` removes the reaper, which changes zombie
handling and is not needed here. A container or microVM Sandbox is the same
shape at larger scale, and the container runtime or VM holds the jobs.

## Reboot

A reboot ends every process, session, namespace and job, so no mechanism can
adopt across it. What survives is files on persistent storage. A job directory
on disk can hold the command, the pid, the start time, the boot id, the output
files and a status file if the wrapper wrote one before the reboot.

A restarted daemon must first read and validate any wrapper status file. A valid
status is terminal even if its boot id differs from the current boot. Only a
job with no valid recorded outcome from another boot is `lost`, with its stored
output. This matches the existing `lost` settlement and needs no new state.
Transient systemd units are gone after a reboot because their files are on
tmpfs, and a persistent unit with `Restart=` starts a new process rather than
adopting an old one. [^systemd-unit][^systemd-service]

A final sampling of the box for the record: kernel 6.18.33.2-microsoft-standard-WSL2,
systemd 249, `pid_max=4194304`, bubblewrap 0.6.1, tmux 3.2a, and no passwordless
sudo, so no system-scope unit was tested.

## macOS personal Nodes

macOS has `setsid(2)` and the double fork, and it has no
`PR_SET_CHILD_SUBREAPER` and no pidfd, which the manual pages mark as Linux
only. [^linux-subreaper][^linux-pidfd-open] There is no `/proc`, so liveness and
identity need other sources. `kill(pid, 0)` gives liveness, and a lock file that
the runner holds with `flock` gives a stronger claim than a bare pid.

launchd is the native holder. Per-user agents live in `~/Library/LaunchAgents`,
`KeepAlive` controls restarts, and `ExitTimeOut` bounds the stop. [^launchd-plist]
A LaunchAgent survives a daemon restart while its user session remains active.
Apple documents that a per-user agent executes only while its user is logged in
and receives `SIGTERM` at logout. [^launchd-lifecycle] It does not give a stable
exit-status query for an arbitrary job, so the wrapper file remains the source
of truth. tmux also works on macOS and needs no launchd job per run.

The macOS path is weaker than Linux in this evidence: no probe was run on a Mac.
The lifecycle description comes from Apple's documentation. Confidence is
moderate for the holder model and low for exact exit-status behavior. [Inference]

## Prior art

- **systemd:** a transient service is parented by the service manager, a stop
  kills the control group, and `Result=` plus `ExecMainStatus=` preserve the
  outcome while the unit remains. A crash of the manager ends its units, so the
  manager is the durable holder, not a recoverable peer. [^systemd-run][^systemd-kill][^systemd-service]
- **tmux:** the server keeps sessions across client disconnects, and a dead pane
  reports its status while retained. Sessions die with the server and do not
  return after a reboot. [^tmux]
- **Shipyard:** `berthd` is a per-box user service and agents run in tmux
  sessions that outlive the daemon and the app. Missing session reports fall
  back to "running", which is a reported state rather than a lost outcome.
  [^shipyard-architecture]
- **Coder:** the agent runs a reconnecting PTY server, so a client reconnect
  attaches to a process held by the agent. The holder is the agent, and an
  agent restart or an agent upgrade loses the job. [Inference] [^coder-reconnectingpty]
- **DevPod:** the injected agent provides an ssh server and an inactivity
  watchdog that stops the container by terminating its pid 1, which kills every
  job in the container. The docs record no job report, so a job in that
  container is lost. [Inference] [^devpod-agent]
- **Codex:** `unified_exec` keeps background terminals in the app-server, with
  `thread/backgroundTerminals/list`, `terminate` and `clean`, and the returned
  `processId` is the app-server's own id. The process store and exit watcher are
  in the app-server process, so an app-server exit loses the jobs. [^codex-app-server][^codex-process-manager]
- **Claude Code:** background Bash writes output to a file and is "automatically
  cleaned up when Claude Code exits". On macOS and Linux that cleanup also stops
  processes that detached under `setsid` or `timeout`, which is a deliberate
  no-survivors policy. [^claude-background]
- **OpenHands:** the terminal tool keeps a persistent session in a tmux pane pool
  or a subprocess PTY inside the runtime. The runtime is the holder, so a
  runtime restart loses the session. [^openhands-terminal]

None of these adopts a running job after its holder's process restarts. systemd,
tmux, Shipyard and OpenHands survive client disconnects. Coder and Codex survive
client reconnects through a holder process. Only a job that writes its own
outcome to disk makes the outcome recoverable after the holder is gone.

| Mechanism                                              | Survives daemon restart                                               | Extra dependency                               | Works under the Sandbox options                                                                                                                                   | How stop works                                                                   | Exit status recovery                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Double fork plus `setsid`, no runner                   | Yes, but nothing reaps or reports it                                  | None                                           | Direct children inherit Landlock and seccomp. Container or microVM lifetime is unchanged.                                                                         | Process group, which misses `setsid` escapees, or a `/proc` walk                 | None unless a wrapper writes a status file                                               |
| Per-job runner (subreaper or plain parent) plus detach | Yes. The runner is the parent, so it reaps and reports.               | None                                           | The runner must start the job under the intended confinement.                                                                                                     | Signal the process group, then the runner and its descendants, or the job cgroup | The runner writes status and output files on every exit path                             |
| systemd transient service per job                      | Yes, the user manager is the parent                                   | systemd, logind, D-Bus, a session or lingering | Does not inherit caller Landlock or seccomp. Reapply confinement inside the unit. Not available in most containers. Needs its own unit or cgroup for cgroup kill. | `systemctl stop` kills the control group, by default `KillMode=control-group`    | `Result=` and `ExecMainStatus=` while the unit remains                                   |
| systemd transient scope per job                        | The unit outlives the client. The run itself is synchronous.          | Same as the service                            | Inherits the caller's Landlock and seccomp.                                                                                                                       | The unit stop kills the cgroup                                                   | No main-process result. Parent must collect status or a separate recorder must write it. |
| tmux or screen session per job                         | Yes, the server is the parent                                         | tmux or screen                                 | A new server inherits confinement; an existing server does not confer caller Landlock or seccomp on new panes. Dies with the user manager or container.           | `kill-session` kills the pane's process tree                                     | `pane_dead_status` while the pane is retained                                            |
| bwrap PID namespace per job                            | Only while the namespace init lives, so a separate holder is required | bubblewrap and user namespaces                 | This is the Sandbox itself. A container or microVM works the same way.                                                                                            | Killing the namespace init kills every member                                    | The sandbox init or the holder writes it, not the new daemon                             |
| Historical Node daemon call                            | No. `endSession` waited for process groups.                           | None                                           | Whatever the daemon had                                                                                                                                           | The abort signal killed the process group                                        | The daemon call result only                                                              |

## Recommendation

1. **Give each job a runner process, not a daemon promise.** The runner is the
   parent, so it reaps the job and writes the status file and output files. It
   survives a daemon restart, and it needs no system dependency. A plain parent
   runner is enough for status. A subreaper runner also collects grandchildren
   that escape the shell. [^linux-subreaper]
2. **Adopt by identity, never by pid alone.** Store the pid, the boot id and the
   start time, and open a pidfd for a job that is still running. Treat a pidfd
   `ESRCH` plus a valid status file as a settled job. If the boot id differs,
   accept a valid status file first and mark only unknown outcomes `lost`.
   [^linux-pidfd-open]
3. **Prefer a cgroup for stop, and keep the process-group kill as a fallback.**
   A job in its own transient unit or delegated cgroup gets a complete stop that
   survives `setsid` escapees. [^cgroup-v2][^systemd-kill]
4. **Treat systemd as an optional accelerator and tmux as a fallback holder.**
   Use a transient unit for stop and status when a user manager exists. Confine
   service jobs inside the unit, and do not rely on a pre-existing tmux server
   to inherit the caller's restrictions. Use a tmux session only when the daemon
   cannot carry a runner and the Machine has tmux. Report the holder in the job
   record so a later event is explainable.
5. **Expect confinement to survive direct detachment only.** A directly
   detached child keeps the daemon's Landlock domain and seccomp filters.
   `LANDLOCK_SCOPE_SIGNAL` can limit signal-based stop. Do not put each job in
   its own PID namespace unless the holder owns that namespace.
   [^linux-landlock][^bubblewrap]
6. **Settle jobs from another boot as `lost` only when their outcome is
   unknown.** Read a valid wrapper status file first. [^llame-job-loss]

## Confidence and limits

The Linux process, pidfd, subreaper, Landlock, seccomp, cgroup and systemd
claims are high confidence from the cited contracts and the contemporaneous
study record. The temporary probe sources and raw output are absent, so these
observations cannot now be independently reproduced.

Three limits apply. The box is WSL2 with systemd 249, so newer systemd behavior
and system-scope units were not exercised. The daemon's own cgroup case is
reasoned from the documentation, because this shell sits in the root cgroup
(`0::/`). No macOS probe was run, and its section is marked accordingly.

This note records Linux process and holder behavior and a candidate job-holder
design. It does not describe the Rust daemon shipped on 2026-11-26 or define the
current background-job contract.

[^linux-pid-namespaces]: [pid_namespaces(7), man-pages 6.12](https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/refs/tags/man-pages-6.12/man/man7/pid_namespaces.7) states that the kernel kills every process in a namespace when its init terminates, and that orphans reparent to the namespace init or a nearer subreaper.

[^linux-subreaper]: [PR_SET_CHILD_SUBREAPER, man-pages 6.12](https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/refs/tags/man-pages-6.12/man/man2/prctl.2) states that orphans reparent to the nearest living ancestor subreaper, that the subreaper reaps them and learns their status, and that the attribute is not inherited across `fork`.

[^linux-pdeathsig]: [PR_SET_PDEATHSIG, man-pages 6.12](https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/refs/tags/man-pages-6.12/man/man2/prctl.2) states that the parent-death signal is cleared for the child of a `fork` and preserved across `execve`.

[^linux-daemon7]: [daemon(7), man-pages 6.12](https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/refs/tags/man-pages-6.12/man/man7/daemon.7) describes the `fork`, `setsid`, `fork` sequence, the reparenting to init, and the race-free PID file requirement.

[^linux-pidfd-open]: [pidfd_open(2), man-pages 6.12](https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/refs/tags/man-pages-6.12/man/man2/pidfd_open.2) describes `poll` on exit, `waitid` only for a child, and the `ESRCH` failure for a process that no longer exists.

[^systemd-kill]: [systemd.kill 249](https://www.freedesktop.org/software/systemd/man/249/systemd.kill.html) documents `KillMode=` with the `control-group` default and the `SIGTERM` then `SIGKILL` escalation.

[^systemd-run]: [systemd-run 249](https://www.freedesktop.org/software/systemd/man/249/systemd-run.html) says a transient service runs in a clean detached environment with the service manager as parent, while a transient scope runs synchronously under `systemd-run`.

[^systemd-unit]: [systemd.unit 249](https://www.freedesktop.org/software/systemd/man/249/systemd.unit.html) lists `/run/systemd/transient` and `$XDG_RUNTIME_DIR/systemd/transient` as the load paths for transient units.

[^systemd-service]: [systemd.service 249](https://www.freedesktop.org/software/systemd/man/249/systemd.service.html) documents service types and `Restart=` supervision.

[^loginctl]: [loginctl 249](https://www.freedesktop.org/software/systemd/man/249/loginctl.html) says `enable-linger` spawns a user manager at boot and keeps it after logouts.

[^logind-conf]: [logind.conf 249](https://www.freedesktop.org/software/systemd/man/249/logind.conf.html) documents `KillUserProcesses=` and user manager termination.

[^cgroup-v2]: [cgroup v2, Linux 6.12](https://docs.kernel.org/6.12/admin-guide/cgroup-v2.html) documents `cgroup.kill`, which kills the cgroup and all descendants by `SIGKILL` and handles concurrent forks.

[^linux-landlock]: [Landlock userspace API, Linux 6.12](https://docs.kernel.org/6.12/userspace-api/landlock.html) states that children inherit the domain, a landlocked thread cannot remove the restriction, and ABI 6 signal scope restricts targets.

[^wsl-systemd]: [Use systemd to manage Linux services with WSL, inspected commit](https://github.com/MicrosoftDocs/WSL/blob/526e57752f7241dc7e98f14b1033905e8e675587/WSL/systemd.md) documents the `[boot] systemd=true` opt-in and the WSL version requirement.

[^claude-background]: [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode) documents background Bash output files, cleanup at exit, and the stop of `setsid` descendants.

[^codex-app-server]: The protocol at the inspected revision defines `thread/backgroundTerminals/list`, `terminate` and `clean`. [Codex app-server protocol](https://github.com/openai/codex/blob/22c1681aec46de3667e4b03786e9d2c9ae6e1066/codex-rs/app-server-protocol/src/protocol/common.rs).

[^codex-process-manager]: [Codex process manager at the inspected revision](https://github.com/openai/codex/blob/22c1681aec46de3667e4b03786e9d2c9ae6e1066/codex-rs/core/src/unified_exec/process_manager.rs) holds the process store and exit watcher in the app-server.

[^shipyard-architecture]: [Shipyard architecture at the inspected revision](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/docs/concepts/architecture.mdx) describes `berthd` as a user service and tmux sessions that outlive the daemon and the app.

[^coder-reconnectingpty]: [Coder reconnecting PTY server at v2.36.6](https://github.com/coder/coder/blob/v2.36.6/agent/reconnectingpty/server.go) keeps the PTY and process in the agent.

[^devpod-agent]: [DevPod provider agent at the inspected commit](https://github.com/loft-sh/devpod/blob/5a0efcbff6610ab114b421f68a890739a452e66b/docs/pages/developing-providers/agent.mdx) describes the injected ssh server and the inactivity stop that terminates the container pid 1.

[^openhands-terminal]: [OpenHands terminal tool](https://github.com/OpenHands/software-agent-sdk/blob/66af27073fb2838734574f33349761777c3b9e0d/openhands-tools/openhands/tools/terminal/README.md) describes the persistent session in a tmux pane pool or a subprocess PTY.

[^launchd-plist]: [launchd.plist at the inspected revision](https://github.com/apple-oss-distributions/launchd/blob/d448a1c8f70a61202f8705f94337f686b87c30c4/man/launchd.plist.5) documents `~/Library/LaunchAgents`, `KeepAlive` and `ExitTimeOut`.

[^launchd-lifecycle]: [Creating Launch Daemons and Agents, version 6.3.4](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) says a user agent executes only while that user is logged in and receives `SIGTERM` at logout.

[^llame-bash-spec]: [bash execution spec](../../../openspec/specs/bash-execution/spec.md) refuses `async` on other Machines until background jobs run there.

[^llame-daemon-serve]: [serve.ts at the inspected pre-rewrite revision](https://github.com/leon0399/llame/blob/852b663d869897ac948f3e67dbbdc8028f54d07c/apps/machine/src/serve.ts) ends a session only after `session.processes.settled()`.

[^llame-job-loss]: [chat-jobs.repository.ts](../../../apps/api/src/jobs/chat-jobs.repository.ts) settles the running jobs of a dead worker as `lost`.
