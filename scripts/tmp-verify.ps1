# 临时：提交并推送
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

git add -A
git commit -m "test(agent,code): 补 composer 队列与 monaco 指纹的自动化断言" -m "- composer-queue: 回灌加 reconciledSessions，同一会话只灌一次（重挂载不再读库）；新增 14 条用例覆盖 Tauri 命令契约 / 线格式文本 / 回灌三态 / 落库顺序" -m "- monaco-types: 新增 7 条用例数 addExtraLib / setCompilerOptions / packTypes 次数，把「连存 10 次只注入 1 次」从手工日志变成可判定断言" | Out-File -Encoding utf8 tmp-git.txt
git log --oneline -1 | Add-Content tmp-git.txt
git push 2>&1 | Add-Content tmp-git.txt
"push-ready exit=$LASTEXITCODE"
