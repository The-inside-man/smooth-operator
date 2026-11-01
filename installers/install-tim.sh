#!/bin/sh
# No curl-pipe-shell, privilege escalation or automatic runtime installation.
set -eu
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 24+ with npm from https://nodejs.org/en/download, reopen your terminal, and rerun.' >&2
  exit 1
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$script_dir/installer.mjs" "$@"
