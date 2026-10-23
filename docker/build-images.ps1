# 在构建机打出生产用 OCI 镜像（Rust cogito + Python compute + postgres）。
# 生产机不要跑本脚本——那边只 pull，见 compose.prod.yaml / guide/deployment.md §8。
#
# 用法（在仓库根）：
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

Write-Host '==> building cogito / compute / postgres (BuildKit cache mounts apply)'
docker compose build cogito-service compute postgres
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $Tag) {
    Write-Host '==> done: cogito:local, cogito-compute:local, cogito-postgres:18-zh-pgvector'
    Write-Host '    set those three in .env.production then: docker compose -f compose.prod.yaml --env-file .env.production up -d'
    exit 0
}

if (-not $Registry) {
    Write-Error ' -Tag requires -Registry (e.g. -Registry registry.example/cogito -Tag 1.2.3)'
}

$Cogito = "${Registry}/cogito:${Tag}"
$Compute = "${Registry}/compute:${Tag}"
$Postgres = "${Registry}/cogito-postgres:${Tag}"

Write-Host "==> tagging $Cogito / $Compute / $Postgres"
docker tag cogito:local $Cogito
docker tag cogito-compute:local $Compute
docker tag cogito-postgres:18-zh-pgvector $Postgres

if ($Push) {
    Write-Host '==> pushing'
    docker push $Cogito
    docker push $Compute
    docker push $Postgres
}

Write-Host @"
==> done
    COGITO_IMAGE=$Cogito
    COMPUTE_IMAGE=$Compute
    POSTGRES_IMAGE=$Postgres
    then: docker compose -f compose.prod.yaml --env-file .env.production pull && up -d
"@
