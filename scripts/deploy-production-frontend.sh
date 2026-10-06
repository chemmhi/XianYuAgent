#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/xianyu-agent-prod}"
WEB_ROOT="${WEB_ROOT:-/var/www/xy.chemhi.top}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/xy.chemhi.top}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"

fail() {
  printf 'deploy-production-frontend: %s\n' "$*" >&2
  exit 1
}

cd "$APP_DIR" || fail "找不到部署目录: $APP_DIR"
[[ -f apps/web/package.json ]] || fail '找不到 apps/web/package.json'
sudo test -d "$WEB_ROOT" || fail "找不到 Nginx 静态目录: $WEB_ROOT"

docker run --rm \
  -u 0 \
  -e NPM_CONFIG_UPDATE_NOTIFIER=false \
  -e NPM_CONFIG_REGISTRY="$NPM_REGISTRY" \
  -v "$PWD:/workspace" \
  -w /workspace \
  node:24-bookworm-slim \
  bash -lc 'rm -rf node_modules apps/api/node_modules apps/web/node_modules SellerAgent/node_modules && npm ci && npm run build:web'

[[ -s apps/web/dist/index.html ]] || fail '前端构建未生成 apps/web/dist/index.html'

release_sha="$(git rev-parse HEAD)"
timestamp="$(date +%Y%m%d%H%M%S)"
backup="$BACKUP_ROOT-$timestamp"
sudo mkdir -p "$backup"
sudo tar -czf "$backup/site.tgz" -C "$WEB_ROOT" .
sudo rsync -a --delete apps/web/dist/ "$WEB_ROOT/"
printf '%s\n' "$release_sha" | sudo tee "$WEB_ROOT/.release-sha" >/dev/null

sudo test -s "$WEB_ROOT/index.html" || fail 'Nginx 静态目录缺少 index.html'
printf 'frontend deploy passed: sha=%s backup=%s web_root=%s\n' "$release_sha" "$backup" "$WEB_ROOT"
