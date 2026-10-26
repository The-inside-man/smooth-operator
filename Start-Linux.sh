#!/bin/sh
set -e
cd "$(dirname "$0")"
if [ -x "release/linux-unpacked/tim-studio" ]; then
  exec release/linux-unpacked/tim-studio
else
  npm run desktop
fi
