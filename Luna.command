#!/bin/zsh
# double-click to start luna 🦎
source ~/.zshrc >/dev/null 2>&1
cd "$(dirname "$0")"
BIN="$(pwd)/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ ! -x "$BIN" ]; then
  echo "electron isn't installed yet, run this in Terminal first:"
  echo "  cd \"$(pwd)\" && npm install && node node_modules/electron/install.js"
  read -k1; exit 1
fi
node setup-canvas.js 2>/dev/null
"$BIN" . > luna.log 2>&1 &
disown
echo "✓ luna is out! (if she doesn't show, check luna.log) you can close this window."
