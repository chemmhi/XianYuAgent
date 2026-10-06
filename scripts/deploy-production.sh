#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/xianyu-agent-prod}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/conf.d/xy.chemhi.top.conf}"
UPSTREAM_PORT="${UPSTREAM_PORT:-18082}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://xy.chemhi.top}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"

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

# 不使用 down -v：保留 PostgreSQL、Redis、MinIO 和 browser_data 数据卷。
# 先启动基础设施并执行迁移，再启动 API/Worker，避免新代码先于已有
# PostgreSQL volume 的 schema 对外提供确认写入。
docker compose -f "$COMPOSE_FILE" up -d --build --force-recreate \
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
printf 'production deploy passed: upstream=127.0.0.1:%s session=%s\n' "$UPSTREAM_PORT" "$session_status"
