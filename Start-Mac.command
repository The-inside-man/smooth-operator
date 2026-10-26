#!/bin/bash
set -e
cd "$(dirname "$0")"

finish() {
  startup_status=$?
  if [ "$startup_status" -ne 0 ]; then
    echo
    echo "TIM Studio could not start. See the error above."
    if [ -t 0 ]; then
      read -r -p "Press Return to close this window..." startup_reply
    fi
  fi
}
trap finish EXIT

case "$(uname -m)" in
  arm64) packaged_app="release/mac-arm64/TIM Studio.app" ;;
  *) packaged_app="release/mac/TIM Studio.app" ;;
esac
if [ -d "$packaged_app" ]; then
  open "$packaged_app"
  exit 0
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Install Node.js 24 or newer (including npm), then open Start-Mac.command again."
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo "TIM Studio needs Node.js 24 or newer. Found $(node --version)."
  exit 1
fi

if [ ! -x node_modules/.bin/tsc ] || [ ! -x node_modules/.bin/vite ] || [ ! -x node_modules/.bin/electron ]; then
  echo "First-time setup: downloading TIM Studio dependencies (internet required)..."
  npm ci --include=dev
fi
if [ ! -x node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ]; then
  echo "Downloading the Electron desktop runtime (internet required)..."
  npm run setup:desktop
fi

npm run desktop
