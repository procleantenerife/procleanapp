#!/bin/bash
set -euo pipefail

# Only run in Claude Code remote (web) sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo "ProClean AIOS: setting up environment..."

# Install serve for local HTTP serving (needed to test PWA / service worker)
if ! npx --yes serve --version &>/dev/null; then
  npm install -g serve
fi

# Install web-push for VAPID key generation
if ! npx --yes web-push --version &>/dev/null; then
  npm install -g web-push
fi

echo "ProClean AIOS: environment ready."
