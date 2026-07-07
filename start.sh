#!/bin/sh
# TableStakes one-command start: checks Node, installs dependencies,
# builds once, and boots the table. Safe to re-run — install and build
# are skipped when already up to date.
set -e
cd "$(dirname "$0")"

say() { printf '%s\n' "$*"; }

# 1. Node 22+
if ! command -v node >/dev/null 2>&1; then
  say ""
  say "  TableStakes needs Node.js (version 22 or newer) and it is not installed."
  say "  Grab it from https://nodejs.org (the LTS button), then run ./start.sh again."
  say ""
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  say ""
  say "  Your Node.js is too old (v$(node -v | tr -d v) — TableStakes needs 22+)."
  say "  Update at https://nodejs.org, then run ./start.sh again."
  say ""
  exit 1
fi

# 2. pnpm via corepack (ships with Node)
if ! command -v pnpm >/dev/null 2>&1; then
  say "  Setting up the package manager (one-time)…"
  corepack enable pnpm >/dev/null 2>&1 || {
    say "  Could not enable pnpm via corepack. Try: npm install -g pnpm"
    exit 1
  }
fi

# 3. Install dependencies. Always resolve against the lockfile so a fresh
#    `git pull` that changed package.json/pnpm-lock.yaml can never start
#    against a stale node_modules (PR #200 review). pnpm is a fast no-op
#    when everything is already current.
if [ ! -d node_modules ]; then
  say "  Installing (first run only, a minute or two)…"
else
  say "  Checking dependencies…"
fi
pnpm install --frozen-lockfile --silent

# 4. Build the app when the build is missing or stale (source, entry
#    page, OR dependency tree newer than the built server).
if [ ! -f dist/server.mjs ] || [ -n "$(find src index.html pnpm-lock.yaml -newer dist/server.mjs -print -quit 2>/dev/null)" ]; then
  say "  Building the table…"
  pnpm build >/dev/null
fi

# 5. Deal.
exec node dist/server.mjs
