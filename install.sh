#!/bin/bash
# one-time setup for Luna on a Mac. run it from the luna folder:  bash install.sh
set -e
cd "$(dirname "$0")"
echo "🦎 setting up luna..."
if ! command -v node >/dev/null 2>&1; then
  echo "Luna needs Node.js 20 or newer. Get it from https://nodejs.org (the LTS button), then run this again."
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "installing Claude Code (Luna's brain, uses your own Claude Pro or Max account)..."
  npm install -g @anthropic-ai/claude-code
fi
npm install-scripts approve electron >/dev/null 2>&1 || true
npm install --legacy-peer-deps
node node_modules/electron/install.js >/dev/null 2>&1 || true
xattr -cr . 2>/dev/null || true
chmod +x Luna.command tools/*.sh 2>/dev/null || true
if ! claude auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; then
  echo "now sign in to Claude (a browser window opens)..."
  claude auth login || true
fi
echo "✓ done! starting luna..."
open Luna.command
