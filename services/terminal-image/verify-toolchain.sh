#!/usr/bin/env bash
set -euo pipefail

for tool in bash git git-lfs ssh curl wget jq rg node npm npx python3 pip3 gcc g++ \
  make pkg-config sqlite3 tar gzip zip unzip rsync file tree nano vim claude slop; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done

git --version
node --version
python3 --version
claude --version
slop help >/dev/null
