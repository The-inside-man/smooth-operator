#!/bin/sh
# Explicit, user-directory runtime bootstrap. No sudo, profile edits or curl-pipe-shell.
set -eu
version=${1:-}; destination=${2:-}; mode=${3:-}
case "$version" in v*) version=${version#v};; esac
if ! printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || [ "${version%%.*}" -lt 24 ] || [ -z "$destination" ]; then
 printf '%s\n' 'Usage: sh bootstrap-node.sh VERSION ABSOLUTE_NEW_DIRECTORY [--plan]' >&2; exit 1
fi
case "$destination" in /*) ;; *) echo 'Choose an absolute directory.' >&2; exit 1;; esac
case "$destination" in *:*) echo 'PATH separator is unsupported in the runtime directory.' >&2; exit 1;; esac
[ "$mode" = '' ] || [ "$mode" = '--plan' ] || { echo 'Unknown option' >&2; exit 1; }
case "$(uname -s)" in Darwin) platform=darwin;; Linux) platform=linux;; *) echo 'This bootstrap supports macOS and Linux.' >&2; exit 1;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64;; arm64|aarch64) arch=arm64;; *) echo 'Unsupported architecture.' >&2; exit 1;; esac
name="node-v$version-$platform-$arch"; base="https://nodejs.org/dist/v$version"; archive="$name.tar.gz"
printf '%s\n' "Source: $base/$archive" "Verification: SHA-256 from $base/SHASUMS256.txt (HTTPS; not independent signer authentication)." "Install: extract into NEW user directory $destination" 'No PATH/profile changes, administrator access, TIM installation or model startup.'
[ "$mode" != '--plan' ] || exit 0
[ ! -e "$destination" ] || { echo 'Destination exists; refusing overwrite.' >&2; exit 1; }
for tool in curl tar mktemp; do command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool" >&2; exit 1; }; done
if command -v sha256sum >/dev/null; then hash_cmd=sha256sum; elif command -v shasum >/dev/null; then hash_cmd=shasum; else echo 'Missing SHA-256 utility.' >&2; exit 1; fi
printf 'Type install to approve this exact runtime/source/directory: '; IFS= read -r answer; [ "$answer" = install ] || { echo 'Cancelled.'; exit 0; }
parent=$(dirname -- "$destination"); [ -d "$parent" ] && [ -w "$parent" ] || { echo 'Parent directory must exist and be writable.' >&2; exit 1; }
stage=$(mktemp -d "$parent/.tim-node-XXXXXX")
trap 'rm -rf -- "$stage"' EXIT HUP INT TERM
curl --fail --silent --show-error --proto '=https' --tlsv1.2 --max-time 60 --max-filesize 1048576 "$base/SHASUMS256.txt" -o "$stage/sums"
expected=$(awk -v f="$archive" '$2==f {print $1}' "$stage/sums")
printf '%s\n' "$expected" | grep -Eq '^[0-9a-fA-F]{64}$' || { echo 'Missing/ambiguous official checksum.' >&2; exit 1; }
curl --fail --silent --show-error --proto '=https' --tlsv1.2 --max-time 300 --max-filesize 134217728 "$base/$archive" -o "$stage/archive"
if [ "$hash_cmd" = sha256sum ]; then actual=$(sha256sum "$stage/archive" | awk '{print $1}'); else actual=$(shasum -a 256 "$stage/archive" | awk '{print $1}'); fi
[ "$actual" = "$expected" ] || { echo 'Checksum mismatch; extraction refused.' >&2; exit 1; }
# Archive is authenticated to the reviewed HTTPS checksum before tar sees it.
tar -tzf "$stage/archive" > "$stage/members"
awk -v root="$name" 'index($0,root "/")!=1 || $0 ~ /(^|\/)\.\.(\/|$)/ {bad=1} END {exit bad}' "$stage/members" || { echo 'Unsafe archive member.' >&2; exit 1; }
tar -xzf "$stage/archive" -C "$stage"
[ -f "$stage/$name/bin/node" ] && [ -f "$stage/$name/lib/node_modules/npm/bin/npm-cli.js" ] || { echo 'Runtime/npm missing from archive.' >&2; exit 1; }
[ ! -e "$destination" ] || { echo 'Destination appeared concurrently; refusing overwrite.' >&2; exit 1; }
mv -T -- "$stage/$name" "$destination" 2>/dev/null || { [ ! -e "$destination" ] && mv -- "$stage/$name" "$destination"; }
printf '%s\n' "Runtime saved at $destination. No PATH changed." "Use $destination/bin/node with the bundled installer.mjs; the TIM installer records that runtime path."
