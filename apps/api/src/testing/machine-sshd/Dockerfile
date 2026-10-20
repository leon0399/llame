# The sshd image the Machine SSH integration suite runs twice: once as the
# `bastion` jump host and once as the `box` running the daemon (remote-machines
# task 4.2). One image serves both roles, because the difference between them is
# only the `authorized_keys` options the suite installs before start — a
# `restrict,port-forwarding,permitopen="box:22"` entry makes a jump host, and
# `restrict,command="/usr/local/bin/llame-machine serve --stdio"` makes the box
# (design D1). The daemon bundle is likewise copied in by the suite, so the
# image never has to be rebuilt when the daemon changes.
#
# Pinned by digest, the same way compose.yaml pins the dev database: a floating
# tag would let an upstream refresh change sshd's behavior with no change here.
# Refresh with:
#   docker pull node:22-bookworm-slim && docker inspect \
#     --format '{{index .RepoDigests 0}}' node:22-bookworm-slim
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

# openssh-server is the fixture under test. iptables is how the suite makes a
# hop drop packets silently: the black-hole case needs NET_ADMIN, which the
# suite adds to the bastion container only.
RUN apt-get update \
  && apt-get install --no-install-recommends --yes openssh-server iptables \
  && rm -rf /var/lib/apt/lists/*

# The Machine user (`box` on both containers). Its shell is what sshd runs the
# forced command through, and its home directory is what the box container's
# registered root lives in. The account is unlocked with a password that
# `PasswordAuthentication no` makes unusable: sshd refuses a `!`-locked account
# even for a public key ("account is locked"), and every hop here is key-only.
# `/run/sshd` is the privilege-separation directory the packaged sshd expects
# but nothing creates without a service manager.
RUN useradd --create-home --shell /bin/bash box \
  && echo 'box:llame-fixture-not-a-credential' | chpasswd \
  && mkdir -p /run/sshd /home/box/.ssh /home/box/work /home/box/.config/llame-machine \
  && chmod 0700 /home/box/.ssh \
  && chmod 0750 /home/box/work

# One registered root, at the location a daemon run by `box` looks in by
# default (`~/.config/llame-machine/roots.json`), plus the file the suite reads
# back through the daemon. The daemon is started by sshd, which hands the child
# only the login environment, so nothing may depend on a Dockerfile ENV here.
COPY roots.json /home/box/.config/llame-machine/roots.json
COPY notes.txt /home/box/work/notes.txt

# Host keys are NOT baked in: the packaged openssh-server generates its own in
# its postinst step, so every pre-existing key is removed here and the
# entrypoint generates one per container on first boot. That gives the bastion
# and the box distinct host keys — which is what makes "a key missing from the
# pinned file" a real refusal — while surviving a restart, because `/etc/ssh`
# lives in the container's writable layer.
RUN rm -f /etc/ssh/ssh_host_* \
  && chown -R box:box /home/box

# The `ssh://` read fixtures (ssh-locator task 4.1), created as root so the box
# account's own permissions decide each case: a plain file and a link to it, an
# empty file, a 2 MiB file, a name with a newline in it, a FIFO, a file and a
# directory only root can read, an empty directory, and a directory past the
# 1,000-entry listing bound. The login-shell startup file is box's `.bashrc`,
# printed through the `BASH_ENV` the plain key's `authorized_keys` line sets:
# sshd's own `bash -c` is not interactive and would not read it otherwise.
RUN mkdir -p /home/box/work/fixture/empty-dir /home/box/work/fixture/many \
  && printf 'symlink target\n' > /home/box/work/fixture/target.txt \
  && ln -s target.txt /home/box/work/fixture/link.txt \
  && : > /home/box/work/fixture/empty.txt \
  && printf 'hidden\n' > /home/box/work/fixture/.hidden.txt \
  && printf 'one\ntwo\nthree\nfour\n' > /home/box/work/fixture/lines.txt \
  && head -c 2097152 /dev/zero | tr '\0' 'a' > /home/box/work/fixture/big.txt \
  && printf 'kept as one entry\n' > "/home/box/work/fixture/$(printf 'line\nbreak.txt')" \
  && mkfifo /home/box/work/fixture/fifo \
  && printf 'root only\n' > /home/box/work/fixture/secret.txt \
  && chmod 0600 /home/box/work/fixture/secret.txt \
  && mkdir -p /home/box/work/fixture/root-only \
  && printf 'root only\n' > /home/box/work/fixture/root-only/inside.txt \
  && chmod 0700 /home/box/work/fixture/root-only \
  && i=0 \
  && while [ "$i" -lt 1500 ]; do : > "/home/box/work/fixture/many/f$(printf %04d "$i")"; i=$((i + 1)); done \
  && printf '%s\n' \
    'echo "llame fixture: login shell startup noise"' \
    'echo "llame fixture: login shell diagnostic noise" >&2' \
    > /home/box/.bashrc

COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /usr/local/bin/machine-sshd
RUN chmod 0755 /usr/local/bin/machine-sshd

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/machine-sshd"]
