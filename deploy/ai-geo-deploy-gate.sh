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
    exec scp -t "$bundle_path"
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
