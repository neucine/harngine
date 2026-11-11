#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
docker build --platform linux/amd64 -t harngine-slice-a-validation:local "$repo_root/scripts/linux"
docker run --rm --platform linux/amd64 --mount "type=bind,source=$repo_root,target=/source,readonly" harngine-slice-a-validation:local bash -euo pipefail -c '
  tar -C /source --exclude=node_modules --exclude=dist --exclude="*.tsbuildinfo" -cf - package.json bun.lock tsconfig.json tsconfig.base.json tsconfig.test.json vitest.config.ts packages scripts | tar -C /work -xf -
  bun install --frozen-lockfile
  bun run check
  bun run test:package
  node -p "process.platform + \" \" + process.arch + \" \" + process.versions.node"
'
