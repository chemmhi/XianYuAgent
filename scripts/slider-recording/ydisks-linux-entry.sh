set -eu
mkdir -p "$XIANYU_RECORD_DIR"
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp -ac >"$XIANYU_RECORD_DIR/xvfb.stdout.log" 2>"$XIANYU_RECORD_DIR/xvfb.stderr.log" &
xvfb_pid=$!
trap 'kill "$xvfb_pid" 2>/dev/null || true' EXIT
export DISPLAY=:99
node "${XIANYU_COPY_BROWSER_ENTRY:-/copy/ydisks-linux-bundle.mjs}"
