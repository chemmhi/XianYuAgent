#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/xianyu-agent-prod}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/conf.d/xy.chemhi.top.conf}"
UPSTREAM_PORT="${UPSTREAM_PORT:-18082}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://xy.chemhi.top}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"
FRONTEND_BUILD_ATTEMPTS="${FRONTEND_BUILD_ATTEMPTS:-3}"
FRONTEND_BUILD_IMAGE="${FRONTEND_BUILD_IMAGE:-node:24-bookworm-slim}"
WEB_ROOT="${WEB_ROOT:-/var/www/xy.chemhi.top}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/xy.chemhi.top}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"

frontend_mutation_started=0
frontend_backup=""

fail() {
  printf 'deploy-production: %s\n' "$*" >&2
  exit 1
}

wait_for_status() {
  local url="$1"
  local expected="$2"
  local attempt status

  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
    status="$(curl -ksS -o /dev/null -w '%{http_code}' "$url" || true)"
    if [[ "$status" == "$expected" ]]; then
      return 0
    fi
    sleep 2
  done

  fail "等待 $url 返回 $expected 超时，最后状态为 $status"
}

wait_for_text() {
  local url="$1"
  local expected="$2"
  local attempt body

  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
    body="$(curl -ksS "$url" || true)"
    if grep -Fq "$expected" <<<"$body"; then
      return 0
    fi
    sleep 2
  done

  fail "等待 $url 包含指定内容超时: $expected"
}

wait_for_postgres() {
  local attempt
  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
    if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  fail "等待 PostgreSQL 接受连接超时"
}

build_frontend() {
  local attempt

  [[ -f apps/web/package.json ]] || fail '找不到 apps/web/package.json'
  sudo test -d "$WEB_ROOT" || fail "找不到 Nginx 静态目录: $WEB_ROOT"

  for ((attempt = 1; attempt <= FRONTEND_BUILD_ATTEMPTS; attempt += 1)); do
    if docker run --rm \
      -u 0 \
      -e NPM_CONFIG_UPDATE_NOTIFIER=false \
      -e NPM_CONFIG_REGISTRY="$NPM_REGISTRY" \
      -v "$PWD:/workspace" \
      -w /workspace \
      "$FRONTEND_BUILD_IMAGE" \
      bash -lc 'rm -rf node_modules apps/api/node_modules apps/web/node_modules SellerAgent/node_modules apps/web/dist && npm ci --no-audit --no-fund --registry="$NPM_CONFIG_REGISTRY" && npm run build:web'; then
      [[ -s apps/web/dist/index.html ]] && return 0
    fi

    printf 'deploy-production: frontend build failed (attempt %s/%s)\n' "$attempt" "$FRONTEND_BUILD_ATTEMPTS" >&2
    sleep "$((attempt * 5))"
  done

  fail '前端构建失败，后端尚未重启'
}

rollback_frontend() {
  if (( frontend_mutation_started != 1 )); then
    return 0
  fi

  if [[ -z "$frontend_backup" || ! -s "$frontend_backup/site.tgz" ]]; then
    printf 'deploy-production: 前端发布失败且找不到可用备份: %s\n' "$frontend_backup" >&2
    return 1
  fi

  printf 'deploy-production: restoring frontend backup %s\n' "$frontend_backup" >&2
  sudo find "$WEB_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  sudo tar -xzf "$frontend_backup/site.tgz" -C "$WEB_ROOT"
  frontend_mutation_started=0
}

on_exit() {
  local status=$?
  trap - EXIT
  if (( status != 0 )); then
    rollback_frontend || true
  fi
  exit "$status"
}

trap on_exit EXIT

cd "$APP_DIR" || fail "找不到部署目录: $APP_DIR"
[[ -f "$COMPOSE_FILE" ]] || fail "找不到 Compose 文件: $APP_DIR/$COMPOSE_FILE"

if [[ "$COMPOSE_FILE" != "compose.prod.yml" && "${ALLOW_NONPROD_COMPOSE:-0}" != "1" ]]; then
  fail "生产部署必须显式使用 compose.prod.yml；如确需覆盖，请设置 ALLOW_NONPROD_COMPOSE=1"
fi

docker compose -f "$COMPOSE_FILE" config --quiet
docker compose -f "$COMPOSE_FILE" config \
  | grep -Eq "published: [\"']?$UPSTREAM_PORT[\"']?$" \
  || fail "$COMPOSE_FILE 未发布 127.0.0.1:$UPSTREAM_PORT，拒绝继续部署"

sudo test -f "$NGINX_SITE" || fail "找不到 Nginx 配置: $NGINX_SITE"
sudo grep -Eq "proxy_pass http://127\\.0\\.0\\.1:$UPSTREAM_PORT([;[:space:]]|$)" "$NGINX_SITE" \
  || fail "Nginx 未反代到 127.0.0.1:$UPSTREAM_PORT，拒绝继续部署"

# 先完成前端构建，再触碰正在运行的 API/Worker。这样 registry/npm/Docker
# 网络或 TypeScript/Vite 构建失败时，不会留下“后端已切换、前端仍旧版”的半发布状态。
build_frontend

# 不使用 down -v 或每次强制重建基础设施：保留 PostgreSQL、Redis、MinIO
# 和 browser_data 数据卷，也避免每次 push 因基础设施镜像仓库波动而失败。
# 首次部署或服务缺失时，Compose 仍会按需创建基础设施；维护时可显式设置
# RECREATE_INFRA=1 重新创建这三个服务。
infra_up_args=(-d)
if [[ "${RECREATE_INFRA:-0}" == "1" ]]; then
  infra_up_args+=(--force-recreate)
fi
docker compose -f "$COMPOSE_FILE" up "${infra_up_args[@]}" \
  postgres redis object-storage
wait_for_postgres
docker compose -f "$COMPOSE_FILE" build api worker
docker compose -f "$COMPOSE_FILE" run --rm --no-deps api node scripts/migrate.mjs
docker compose -f "$COMPOSE_FILE" up -d --force-recreate api worker

wait_for_status "http://127.0.0.1:$UPSTREAM_PORT/healthz" "200"
wait_for_status "http://127.0.0.1:$UPSTREAM_PORT/readyz" "200"
wait_for_status "$PUBLIC_BASE_URL/healthz" "200"
wait_for_status "$PUBLIC_BASE_URL/readyz" "200"

session_status="$(curl -ksS -o /dev/null -w '%{http_code}' "$PUBLIC_BASE_URL/api/v1/auth/session" || true)"
case ",$session_status," in
  *,200,*|*,401,*|*,403,*) ;;
  *) fail "会话接口返回异常状态: $session_status" ;;
esac

docker compose -f "$COMPOSE_FILE" ps

# 后端已通过健康检查后才发布 UI；任何 rsync/验收失败都会恢复旧静态目录。
release_sha="$(git rev-parse HEAD)"
timestamp="$(date +%Y%m%d%H%M%S)"
frontend_backup="$BACKUP_ROOT-$timestamp"
sudo mkdir -p "$frontend_backup"
sudo tar -czf "$frontend_backup/site.tgz" -C "$WEB_ROOT" .
frontend_mutation_started=1
sudo rsync -a --delete apps/web/dist/ "$WEB_ROOT/"
printf '%s\n' "$release_sha" | sudo tee "$WEB_ROOT/.release-sha" >/dev/null

sudo test -s "$WEB_ROOT/index.html" || fail 'Nginx 静态目录缺少 index.html'
wait_for_status "$PUBLIC_BASE_URL/" "200"
wait_for_text "$PUBLIC_BASE_URL/" 'id="root"'
frontend_mutation_started=0

printf 'production deploy passed: sha=%s upstream=127.0.0.1:%s session=%s frontend=%s backup=%s\n' \
  "$release_sha" "$UPSTREAM_PORT" "$session_status" "$WEB_ROOT" "$frontend_backup"
