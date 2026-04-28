#!/usr/bin/env bash
#
# /schedule から呼ばれる rekishi auto のラッパスクリプト。
# 朝 7:00 / 夕 19:00 の 2 ジョブとして登録する想定。
#
# 設定:
#   REPO_ROOT  : リポジトリのフルパス（既定: /Users/okawa.h/Desktop/rekishi-shorts）
#   PNPM_PATH  : pnpm コマンドのフルパス（PATH に無ければ指定）
#
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/Users/okawa.h/Desktop/rekishi-shorts}"
cd "$REPO_ROOT"

# pnpm を見つける（launchd / cron 配下では PATH が薄いので保険）
if ! command -v pnpm >/dev/null 2>&1; then
  for cand in /opt/homebrew/bin/pnpm /usr/local/bin/pnpm "$HOME/.local/share/pnpm/pnpm"; do
    if [[ -x "$cand" ]]; then
      export PATH="$(dirname "$cand"):$PATH"
      break
    fi
  done
fi

mkdir -p data/rekishi/auto-logs
LOG="data/rekishi/auto-logs/$(date +%Y%m%d-%H%M%S).log"

{
  echo "=== auto-rekishi started at $(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z) ==="
  echo "    pwd=$(pwd)"
  echo "    pnpm=$(command -v pnpm || echo 'NOT FOUND')"
  pnpm --filter @rekishi/pipeline exec tsx src/cli.ts auto publish --channel rekishi --mode unattended
  EXIT=$?
  echo "=== auto-rekishi finished at $(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z) (exit $EXIT) ==="
  exit "$EXIT"
} >>"$LOG" 2>&1
