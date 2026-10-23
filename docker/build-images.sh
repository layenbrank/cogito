#!/usr/bin/env bash
# 在构建机打出生产用 OCI 镜像（Rust cogito + Python compute + postgres）。
# 生产机不要跑本脚本——那边只 pull，见 compose.prod.yaml / guide/deployment.md §8。
#
# 用法（在仓库根）：
#   ./docker/build-images.sh
#   ./docker/build-images.sh --tag 1.2.3 --registry registry.example/cogito
#   ./docker/build-images.sh --tag 1.2.3 --registry registry.example/cogito --push

set -euo pipefail

TAG=""
REGISTRY=""
PUSH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="${2:-}"; shift 2 ;;
    --registry) REGISTRY="${2:-}"; shift 2 ;;
    --push) PUSH=1; shift ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> building cogito / compute / postgres (BuildKit cache mounts apply)"
docker compose build cogito-service compute postgres

if [[ -z "$TAG" ]]; then
  echo "==> done: cogito:local, cogito-compute:local, cogito-postgres:18-zh-pgvector"
  echo "    set those three in .env.production then:"
  echo "    docker compose -f compose.prod.yaml --env-file .env.production up -d"
  exit 0
fi

if [[ -z "$REGISTRY" ]]; then
  echo "error: --tag requires --registry" >&2
  exit 1
fi

COGITO="${REGISTRY}/cogito:${TAG}"
COMPUTE="${REGISTRY}/compute:${TAG}"
POSTGRES="${REGISTRY}/cogito-postgres:${TAG}"

echo "==> tagging ${COGITO} / ${COMPUTE} / ${POSTGRES}"
docker tag cogito:local "$COGITO"
docker tag cogito-compute:local "$COMPUTE"
docker tag cogito-postgres:18-zh-pgvector "$POSTGRES"

if [[ "$PUSH" -eq 1 ]]; then
  echo "==> pushing"
  docker push "$COGITO"
  docker push "$COMPUTE"
  docker push "$POSTGRES"
fi

cat <<EOF
==> done
    COGITO_IMAGE=${COGITO}
    COMPUTE_IMAGE=${COMPUTE}
    POSTGRES_IMAGE=${POSTGRES}
    then: docker compose -f compose.prod.yaml --env-file .env.production pull && up -d
EOF
