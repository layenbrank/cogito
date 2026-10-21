# 在构建机打出生产用 OCI 镜像（Rust cogito + Python ai-worker + postgres）。
# 生产机不要跑本脚本——那边只 pull，见 docker-compose.prod.yml / guide/deployment.md §8。
#
# 用法（在 apps/cogito 下）：
#   .\docker\build-images.ps1
#   .\docker\build-images.ps1 -Tag 1.2.3 -Registry registry.example/cogito
#   .\docker\build-images.ps1 -Tag 1.2.3 -Registry registry.example/cogito -Push
#
# -Tag / -Registry 会额外打出 $Registry/cogito:$Tag 等；不传则只编 :local 供本机验产。

[CmdletBinding()]
param(
    [string] $Tag = '',
    [string] $Registry = '',
    [switch] $Push
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host '==> building cogito / ai-worker / postgres (BuildKit cache mounts apply)'
docker compose build cogito-api ai-worker postgres
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $Tag) {
    Write-Host '==> done: cogito:local, cogito-ai-worker:local, cogito-postgres:18-zh-pgvector'
    Write-Host '    set those three in .env.production then: docker compose -f docker-compose.prod.yml --env-file .env.production up -d'
    exit 0
}

if (-not $Registry) {
    Write-Error ' -Tag requires -Registry (e.g. -Registry registry.example/cogito -Tag 1.2.3)'
}

$Cogito = "${Registry}/cogito:${Tag}"
$AiWorker = "${Registry}/ai-worker:${Tag}"
$Postgres = "${Registry}/cogito-postgres:${Tag}"

Write-Host "==> tagging $Cogito / $AiWorker / $Postgres"
docker tag cogito:local $Cogito
docker tag cogito-ai-worker:local $AiWorker
docker tag cogito-postgres:18-zh-pgvector $Postgres

if ($Push) {
    Write-Host '==> pushing'
    docker push $Cogito
    docker push $AiWorker
    docker push $Postgres
}

Write-Host @"
==> done
    COGITO_IMAGE=$Cogito
    AI_WORKER_IMAGE=$AiWorker
    POSTGRES_IMAGE=$Postgres
    then: docker compose -f docker-compose.prod.yml --env-file .env.production pull && up -d
"@
