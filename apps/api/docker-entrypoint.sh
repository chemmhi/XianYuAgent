#!/bin/sh
set -eu

# google-chrome-stable is installed from the moving stable channel. Export the
# exact runtime build before Node imports the browser identity module so the
# browser, MTOP, QR and IM layers share one fingerprint.
if [ -z "${XIANYU_BROWSER_CHROME_VERSION:-}" ] && command -v google-chrome >/dev/null 2>&1; then
  version="$(google-chrome --version | sed -nE 's/.* ([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+).*/\1/p')"
  if [ -n "$version" ]; then
    export XIANYU_BROWSER_CHROME_VERSION="$version"
  fi
fi

exec "$@"
