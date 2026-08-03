#!/bin/sh

set -eu
set -f

project_root=/opt/ai-geo-monitoring
original_command=${SSH_ORIGINAL_COMMAND:-}

is_commit() {
  printf '%s' "$1" | grep -Eq '^[0-9a-f]{40}$'
}

is_checksum() {
  printf '%s' "$1" | grep -Eq '^[0-9a-f]{64}$'
}

case "$original_command" in
  "scp -t /tmp/ai-geo-release-"*".bundle")
    bundle_path=${original_command#scp -t }
    revision=${bundle_path#/tmp/ai-geo-release-}
    revision=${revision%.bundle}
    is_commit "$revision"
    [ "$bundle_path" = "/tmp/ai-geo-release-${revision}.bundle" ]
    if [ -e "$bundle_path" ] || [ -L "$bundle_path" ]; then
      printf '%s\n' 'Bundle 临时路径已存在，拒绝覆盖。' >&2
      exit 126
    fi
    if ! (umask 077; set -C; : > "$bundle_path") 2>/dev/null; then
      printf '%s\n' '无法安全预留 Bundle 临时路径。' >&2
      exit 126
    fi
    cleanup_bundle() {
      rm -f -- "$bundle_path"
    }
    trap 'cleanup_bundle; exit 126' HUP INT TERM
    if scp -t "$bundle_path"; then
      trap - HUP INT TERM
      exit 0
    else
      status=$?
      cleanup_bundle
      trap - HUP INT TERM
      exit "$status"
    fi
    ;;
  "cd /opt/ai-geo-monitoring && node scripts/deploy-from-bundle.mjs "*)
    set -- $original_command
    [ "$#" -eq 8 ]
    [ "$1" = "cd" ]
    [ "$2" = "$project_root" ]
    [ "$3" = "&&" ]
    [ "$4" = "node" ]
    [ "$5" = "scripts/deploy-from-bundle.mjs" ]
    revision=${7#--revision=}
    checksum=${8#--sha256=}
    is_commit "$revision"
    is_checksum "$checksum"
    [ "$6" = "--bundle=/tmp/ai-geo-release-${revision}.bundle" ]
    [ "$7" = "--revision=${revision}" ]
    [ "$8" = "--sha256=${checksum}" ]
    cd "$project_root"
    exec node scripts/deploy-from-bundle.mjs "$6" "$7" "$8"
    ;;
  *)
    printf '%s\n' '该 SSH 密钥只允许上传并部署已校验的 ai-geo Git Bundle。' >&2
    exit 126
    ;;
esac
