#!/usr/bin/env bash
set -Eeuo pipefail
app_dir="${1:?repository directory required}"
config_dir="$app_dir/runtime-config"
target="$config_dir/xianyu-system-users.json"
mkdir -p "$config_dir"
# Publish a complete file exclusively. Existing files (even invalid/empty) are operator-owned.
if [[ ! -e "$target" && ! -L "$target" ]]; then
  temporary="$(mktemp "$config_dir/.system-users.XXXXXX")"
  trap 'rm -f -- "$temporary"' EXIT
  cat "$app_dir/apps/api/config/xianyu-system-users.example.json" > "$temporary"
  chmod 644 "$temporary"
  ln "$temporary" "$target" || [[ -f "$target" ]]
fi
[[ -f "$target" ]] || { printf 'system user configuration must be a file\n' >&2; exit 1; }
