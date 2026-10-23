# 跨进程联调的任务驱动：建一条 agent 任务，等它停在审批闸门上，批准，然后看结局。
#
#   pwsh apps/service/tests/e2e/run_agent_task.ps1
#
# 前提：
#   * 先跑过 seed_app.ps1（要它写出的 seed.json）；
#   * cogito 侧 `agent.chat_model` 指向 seed_gateway.sql 播下的那个对话模型，
#     `agent.allowed_tools` 里带上 `asset_visibility_write`（写工具默认不在白名单里，
#     不显式打开就永远看不到审批闸门那一幕）；
#   * 模型桩在跑（见 model_stub.py），它的 `STUB_ASSET_ID` 必须是 seed 出来的那个资产
#     ——桩只会对硬编码的那个资产动手，对不上就是「工具改的资产和你要看的不是同一个」。
#
# 产物：`task_final.json`（终态快照）写进临时目录（见 common.ps1）。
# 退出码：任务没跑到 `SUCCEEDED` 就非 0，可以直接当门禁用。

. (Join-Path $PSScriptRoot 'common.ps1')

$seedFile = Join-Path $script:E2EOut 'seed.json'
if (-not (Test-Path $seedFile)) { throw "找不到 $seedFile，先跑 seed_app.ps1" }
$seed = Get-Content $seedFile -Raw | ConvertFrom-Json

# 带租户的接口都要 X-Tenant-ID，缺了会被拒（200001）。
$tenantHeader = @{ 'X-Tenant-ID' = $seed.tenantId }

$created = Invoke-Cogito -Method POST -Path '/api/v1/agent/tasks' -Token $seed.ownerToken -Header $tenantHeader -Body @{
    objective = "把资产 $($seed.assetId) 的可见性改成 RESTRICTED，只给 $($seed.viewerId) 看。"
}
$taskId = (Assert-Ok $created '创建任务').id
Write-Host "taskId = $taskId"

$approved = $false
$last = ''
$task = $null
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    $task = Assert-Ok (Invoke-Cogito -Method GET -Path "/api/v1/agent/tasks/$taskId" -Token $seed.ownerToken -Header $tenantHeader) '读任务'

    # `steps` 是整数（轮次），别写成 `$task.steps.Count`：标量的 `.Count` 恒为 1，会把 2 轮显示成 1。
    $line = "status=$($task.status) progress=$($task.progress) steps=$($task.steps) approval=$($task.pendingApproval.approvalID)"
    if ($line -ne $last) { Write-Host "[$i] $line"; $last = $line }

    # 停在原地等人工决定的那一幕：先把「在等哪一次调用」打出来，再批准。
    if (-not $approved -and $task.pendingApproval) {
        Write-Host "pendingApproval = $($task.pendingApproval | ConvertTo-Json -Compress -Depth 8)"
        $approvalId = $task.pendingApproval.approvalID
        $decided = Invoke-Cogito -Method POST -Path "/api/v1/agent/tasks/$taskId/approvals/$approvalId" `
            -Token $seed.ownerToken -Header $tenantHeader -Body @{ decision = 'APPROVED'; reason = '联调批准' }
        Write-Host "approval => $($decided | ConvertTo-Json -Compress -Depth 8)"
        $approved = $true
    }

    # 台账状态只有 RUNNING / SUCCEEDED / FAILED 三个（词汇定义在 crates/agent），
    # 所以「不是 RUNNING」就是终态，不用再等满整轮。
    if ($task.status -ne 'RUNNING') { break }
}

Save-E2EJson -Path (Join-Path $script:E2EOut 'task_final.json') -Value $task

Write-Host "最终：status=$($task.status) steps=$($task.steps) toolCalls=$($task.result.toolCalls) memoryID=$($task.result.memoryID)"
if ($task.status -ne 'SUCCEEDED') {
    Write-Host ($task | ConvertTo-Json -Depth 10)
    throw "任务没有跑成功（status=$($task.status)）：完整快照见 $script:E2EOut\task_final.json"
}

# 少一条长期记忆不致命（任务照样 SUCCEEDED），但那是**嵌入这条腿降级**的信号：
# 网关里找不到 `compute.embed_model` 对应、且声明了 `capabilities.embeddings = true` 的模型。
# 联调要的是全绿，所以这里当门禁拦下，并把「该怎么补」直接写在报错里。
if (-not $task.result.memoryID) {
    throw '任务成功了但没有 result.memoryID：收尾写长期记忆那一步降级了。检查 gateway_model 里是否存在 name = compute.embed_model 且 capabilities.embeddings = true 的行（见 seed_gateway.sql）。'
}

Write-Host '落库核对：资产可见性 / agent_approval / gateway_usage / gateway_audit / agent_memory'
