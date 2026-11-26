#!/bin/sh
set -eu

case "${SSH_ORIGINAL_COMMAND-}" in
  'llame-machine attach --print-socket')
    exec /usr/local/bin/llame-machine attach --print-socket
    ;;
  'llame-machine attach --stdio')
    exec /usr/local/bin/llame-machine attach --stdio
    ;;
  *)
    printf '%s\n' 'machine-sshd: refused an unsupported SSH command' >&2
    exit 126
    ;;
esac
