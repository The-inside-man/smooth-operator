#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ -d "release/mac-arm64/TIM Studio.app" ]; then
  open "release/mac-arm64/TIM Studio.app"
elif [ -d "release/mac/TIM Studio.app" ]; then
  open "release/mac/TIM Studio.app"
else
  npm run desktop
fi
