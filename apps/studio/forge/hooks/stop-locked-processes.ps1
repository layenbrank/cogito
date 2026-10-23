<#
  结束占用打包产物的本仓库进程（Windows 下 electron 会锁住 asar / out 目录）。

  仅结束可执行文件路径落在 -Root 之内的 electron / cogito，
  避免误杀仓库之外的其它 Electron 应用。
  无论是否有进程被结束，一律 exit 0：单个进程取不到 Path 或刚好退出，
  都不该让 prePackage 钩子变成失败。
#>
param([string]$Root)

if ([string]::IsNullOrWhiteSpace($Root)) {
  Write-Error 'stop-locked-processes.ps1 需要 -Root <monorepo 根目录>'
  exit 1
}

$ErrorActionPreference = 'SilentlyContinue'
$prefix = $Root.Replace('\', '/').ToLower()

$lockers = Get-Process | Where-Object {
  $_.ProcessName -match '^(electron|cogito|studio)$' -and
  $_.Path -and
  $_.Path.Replace('\', '/').ToLower().StartsWith($prefix)
}

foreach ($locker in $lockers) {
  Stop-Process -Id $locker.Id -Force
}

exit 0
