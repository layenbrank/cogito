#!/usr/bin/env bash
# 在构建机打出生产用 OCI 镜像（Rust cogito + Python ai-worker + postgres）。
# 生产机不要跑本脚本——那边只 pull，见 docker-compose.prod.yml / guide/deployment.md §8。
#
# 用法（在 apps/cogito 下）：
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

echo "==> building cogito / ai-worker / postgres (BuildKit cache mounts apply)"
docker compose build cogito-api ai-worker postgres

if [[ -z "$TAG" ]]; then
  echo "==> done: cogito:local, cogito-ai-worker:local, cogito-postgres:18-zh-pgvector"
  echo "    set those three in .env.production then:"
  echo "    docker compose -f docker-compose.prod.yml --env-file .env.production up -d"
  exit 0
fi

if [[ -z "$REGISTRY" ]]; then
  echo "error: --tag requires --registry" >&2
  exit 1
fi

COGITO="${REGISTRY}/cogito:${TAG}"
AI_WORKER="${REGISTRY}/ai-worker:${TAG}"
POSTGRES="${REGISTRY}/cogito-postgres:${TAG}"

echo "==> tagging ${COGITO} / ${AI_WORKER} / ${POSTGRES}"
docker tag cogito:local "$COGITO"
docker tag cogito-ai-worker:local "$AI_WORKER"
docker tag cogito-postgres:18-zh-pgvector "$POSTGRES"

if [[ "$PUSH" -eq 1 ]]; then
  echo "==> pushing"
  docker push "$COGITO"
  docker push "$AI_WORKER"
  docker push "$POSTGRES"
fi

cat <<EOF
==> done
    COGITO_IMAGE=${COGITO}
    AI_WORKER_IMAGE=${AI_WORKER}
    POSTGRES_IMAGE=${POSTGRES}
    then: docker compose -f docker-compose.prod.yml --env-file .env.production pull && up -d
EOF
