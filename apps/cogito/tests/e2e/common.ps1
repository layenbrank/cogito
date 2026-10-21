# 跨进程联调（真 cogito + 真 ai-worker）脚本的公共工具，由同目录的 seed_app.ps1 /
# run_agent_task.ps1 在开头 dot-source。
#
# 运行时产物（请求体、seed.json、task_final.json）一律写进系统临时目录，不落在工作树里：
# 联调跑到一半留下的 JSON 不该被误提交，仓库的 `git status` 该一直是干净的。

$ErrorActionPreference = 'Stop'

# cogito 的地址可覆盖：cogito 换端口或跑在别处时不用改脚本。
$script:E2EBase = if ($env:E2E_COGITO_BASE) { $env:E2E_COGITO_BASE } else { 'http://127.0.0.1:3000' }
$script:E2EOut = Join-Path ([System.IO.Path]::GetTempPath()) 'cogito-service-agent-e2e'
if (-not (Test-Path $script:E2EOut)) { New-Item -ItemType Directory -Path $script:E2EOut | Out-Null }

# 无 BOM 的 UTF-8：默认 `Set-Content -Encoding utf8` 在 Windows PowerShell 5.1 下会写 BOM，
# 而 curl 是把文件字节原样发出去的，带上 BOM 上游就收到「非法 JSON」。
$script:E2EUtf8 = New-Object System.Text.UTF8Encoding($false)

function Save-E2EJson {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Value
    )
    [System.IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 10), $script:E2EUtf8)
}

# 用 curl.exe 而不是 Invoke-RestMethod：分片上传要 `-F`，而且失败时必须能看到**原始**响应体
# ——「响应体不是 JSON」这类故障只有拿到原文才判得出来。
function Invoke-Cogito {
    param(
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        $Body,
        [string]$Token,
        [hashtable]$Header
    )

    $argv = @('-sS', '-X', $Method, "$script:E2EBase$Path")
    if ($null -ne $Body) {
        $bodyFile = Join-Path $script:E2EOut 'request.json'
        [System.IO.File]::WriteAllText($bodyFile, ($Body | ConvertTo-Json -Compress -Depth 8), $script:E2EUtf8)
        $argv += @('-H', 'Content-Type: application/json', '--data', "@$bodyFile")
    }
    if ($Token) { $argv += @('-H', "Authorization: Bearer $Token") }
    if ($Header) { foreach ($k in $Header.Keys) { $argv += @('-H', ('{0}: {1}' -f $k, $Header[$k])) } }

    $raw = curl.exe @argv
    if ($LASTEXITCODE -ne 0) { throw "curl 退出码 $LASTEXITCODE（$Method $Path）：$raw" }
    try { return $raw | ConvertFrom-Json } catch { throw "非 JSON 响应（$Method $Path）：$raw" }
}

# 统一的失败口径：cogito 的响应体恒为 `{ success, code, msg, data }`。
function Assert-Ok {
    param(
        $Response,
        [Parameter(Mandatory)][string]$What
    )
    if (-not $Response.success) { throw "$What 失败：$($Response | ConvertTo-Json -Compress -Depth 8)" }
    return $Response.data
}
