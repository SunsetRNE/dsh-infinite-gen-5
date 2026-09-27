#!/usr/bin/env bash
# 无限五代 · 版本号单点改写（薄包装，逻辑在 scripts/bump-version.mjs）
# 用法：bash scripts/bump-version.sh X.Y.Z [--dry]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node scripts/bump-version.mjs "$@"
