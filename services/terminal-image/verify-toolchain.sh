#!/usr/bin/env bash
set -euo pipefail

git --version
node --version
npm --version
npx --version
rg --version | head -1
sqlite3 --version
claude --version
slop help >/dev/null
