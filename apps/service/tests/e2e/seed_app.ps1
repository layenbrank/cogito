# 跨进程联调的业务数据播种：两个用户（owner = 资产创建者兼审批人、viewer = 可见性名单）
# + 一个租户 + 一个带 tenantID 的资产。
#
#   pwsh apps/service/tests/e2e/seed_app.ps1
#
# 前提：cogito 已在跑（默认 http://127.0.0.1:3000，可用 E2E_COGITO_BASE 覆盖），
# 且核心配置里 `auth.captcha.enabled = false`（终端联调过不了图形验证码）。
#
# 产物写到临时目录（见 common.ps1）：`seed.json` 里是后面 run_agent_task.ps1 要用的 id 与 token。
# 幂等：用户/租户已存在就复用，资产每次新建一个。

. (Join-Path $PSScriptRoot 'common.ps1')

$fixture = (Resolve-Path (Join-Path $PSScriptRoot '..\..\http\fixtures\chunk-0.bin')).Path
$fileHash = (Get-FileHash $fixture -Algorithm SHA256).Hash.ToLower()
$fileSize = (Get-Item $fixture).Length

function Ensure-User {
    param([Parameter(Mandatory)][string]$Name)

    $creds = @{ username = $Name; password = 'e2e-pass-1234'; captchaKey = 'e2e'; captchaValue = 'e2e' }
    $signup = Invoke-Cogito -Method POST -Path '/api/v1/auth/signup' -Body $creds
    if ($signup.success) { return $signup.data }
    if ($signup.msg -ne '用户名已存在') { throw "注册 $Name 失败：$($signup | ConvertTo-Json -Compress -Depth 8)" }
    return Assert-Ok (Invoke-Cogito -Method POST -Path '/api/v1/auth/signin' -Body $creds) "登录 $Name"
}

$owner = Ensure-User -Name 'e2euser'
$viewer = Ensure-User -Name 'e2eviewer'
$ownerToken = $owner.token

# 租户：asset 必须挂在租户下，否则 agent 的服务身份在租户作用域里看不到它，
# 工具会回「资产不存在」——这是最容易误判成「工具坏了」的一处。
$tenantResp = Invoke-Cogito -Method POST -Path '/api/v1/tenants' -Token $ownerToken -Body @{
    name = 'E2E Team'; slug = 'e2e-team'; type = 'TEAM'
}
if ($tenantResp.success) {
    $tenant = $tenantResp.data
} elseif ($tenantResp.msg -eq '租户标识已存在') {
    $page = Assert-Ok (Invoke-Cogito -Method GET -Path '/api/v1/tenants?page=1&size=50' -Token $ownerToken) '列出租户'
    $rows = if ($page.PSObject.Properties.Name -contains 'list') { $page.list } else { $page }
    $tenant = $rows | Where-Object { $_.slug -eq 'e2e-team' } | Select-Object -First 1
    if (-not $tenant) { throw "租户已存在但当前用户看不到：$($tenantResp | ConvertTo-Json -Compress)" }
} else {
    throw "创建租户失败：$($tenantResp | ConvertTo-Json -Compress -Depth 8)"
}

$prep = Assert-Ok (Invoke-Cogito -Method POST -Path '/api/v1/upload/prepare' -Token $ownerToken -Body @{
        name = 'e2e-note.txt'; size = $fileSize; hash = $fileHash; mime = 'text/plain'
        chunk = 10485760; tenantID = $tenant.id; visibility = 'PRIVATE'
    }) '初始化上传'

# 分片走 `-F`（multipart），所以这里单独用一次 curl，不复用 Invoke-Cogito。
$chunkRaw = curl.exe -sS -X POST "$script:E2EBase/api/v1/upload/chunk" -H "Authorization: Bearer $ownerToken" `
    -F "id=$($prep.id)" -F 'index=0' -F "hash=$fileHash" -F "chunk=@$fixture;type=application/octet-stream"
$chunk = $chunkRaw | ConvertFrom-Json
if (-not $chunk.success) { throw "分片上传失败：$chunkRaw" }

$fin = Assert-Ok (Invoke-Cogito -Method POST -Path '/api/v1/upload/finalize' -Token $ownerToken -Body @{
        id = $prep.id
    }) '完成上传'

$state = [ordered]@{
    ownerId    = $owner.id
    ownerToken = $ownerToken
    viewerId   = $viewer.id
    tenantId   = $tenant.id
    assetId    = $prep.id
    assetURL   = $fin.url
}
$seedFile = Join-Path $script:E2EOut 'seed.json'
Save-E2EJson -Path $seedFile -Value $state

Write-Host "owner=$($state.ownerId)  viewer=$($state.viewerId)  tenant=$($state.tenantId)"
Write-Host "asset=$($state.assetId)"
Write-Host "seed 已写入 $seedFile"
