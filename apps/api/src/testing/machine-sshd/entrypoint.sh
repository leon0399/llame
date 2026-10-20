#!/bin/sh
# The fixture's process 1: install the hub key this container is started with,
# then serve sshd in the foreground with logs on stderr (nothing collects
# syslog in a container, and the suite waits for sshd's own "Server listening"
# line to know the container is ready).
set -eu

# The suite copies this file in before the container starts. It is the whole
# difference between the two containers: plain forwarding for the bastion, the
# forced command for the box.
if [ -f /tmp/llame-setup/authorized_keys ]; then
  install -d -m 0700 -o box -g box /home/box/.ssh
  install -m 0600 -o box -g box /tmp/llame-setup/authorized_keys /home/box/.ssh/authorized_keys
else
  echo "machine-sshd: /tmp/llame-setup/authorized_keys is missing" >&2
  exit 1
fi

mkdir -p /run/sshd

# One key per container, on first boot and after a restart only if missing: the
# suite reads this key back to pin it, so it must be stable across the restart
# the recovery test performs.
if [ ! -f /etc/ssh/ssh_host_ed25519_key ]; then
  ssh-keygen -q -t ed25519 -N '' -C machine-sshd-fixture -f /etc/ssh/ssh_host_ed25519_key
fi

exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
