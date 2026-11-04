import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Switch } from '@cogito/design/components/switch'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { ensurePersist, findPref, patchPref } from '@/features/persist'
import {
  formatBytes,
  openDiagnosticDir,
  probeCapabilities,
  readDiagnosticsCapabilities,
  type Capabilities,
  type DiagnosticsCapabilities,
  type ToolCapability
} from '@/lib/diagnostics/capabilities'
import { reportPendingCrashes } from '@/lib/diagnostics/crash-report'
import {
  SURFACE_STACK,
  SettingsRow,
  SettingsSection
} from '@/views/settings/surfaces/section.tsx'

const VARIANT_LABEL: Record<string, string> = {
  slim: '精简版',
  full: '完整版'
}

function variantLabel(variant: string | undefined): string {
  if (!variant) return '未知'
  return VARIANT_LABEL[variant] ?? variant
}

function toolStatus(capability: ToolCapability): { text: string; tone: 'success' | 'secondary' | 'destructive' } {
  if (capability.present) return { text: '已内置', tone: 'success' }
  // 精简版缺「只有完整版才有」的件是设计如此，不该标红
  if (capability.fullOnly) return { text: '需完整版', tone: 'secondary' }
  return { text: '缺失', tone: 'destructive' }
}

/** 设置 → 诊断：能力自述 / 日志目录 / 崩溃补报开关。 */
function DiagnosticSurface() {
  const [caps, setCaps] = useState<DiagnosticsCapabilities | null>(null)
  const [tools, setTools] = useState<Capabilities | null>(null)
  const [reportCrashes, setReportCrashes] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [isReporting, setIsReporting] = useState(false)

  const reload = useCallback(async function reload(): Promise<void> {
    setIsLoading(true)
    try {
      const [nextCaps, nextTools] = await Promise.all([
        readDiagnosticsCapabilities(),
        probeCapabilities()
      ])
      setCaps(nextCaps)
      setTools(nextTools)
    } catch (error) {
      console.warn('[settings.diagnostics] 读取诊断信息失败', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(
    function () {
      // 上报开关是本地偏好（sync 读），与能力探测并行
      void ensurePersist()
        .then(function () {
          setReportCrashes(findPref('diagnostics').reportCrashes)
        })
        .catch(function (error) {
          console.warn('[settings.diagnostics] 读取上报开关失败', error)
        })
      void reload()
    },
    [reload]
  )

  async function onToggleReport(checked: boolean): Promise<void> {
    setReportCrashes(checked)
    try {
      await patchPref('diagnostics', { reportCrashes: checked })
      toast.success(checked ? '崩溃现场会自动上报' : '已关闭自动上报，现场只留在本地')
    } catch (error) {
      setReportCrashes(!checked)
      const text = error instanceof Error ? error.message : String(error)
      toast.error(`保存上报开关失败：${text}`)
    }
  }

  async function onOpen(kind: 'log' | 'crash' | 'data', label: string): Promise<void> {
    const opened = await openDiagnosticDir(kind)
    if (opened) {
      toast.success(`已打开${label}`, { description: opened })
      return
    }
    toast.error(`打不开${label}`, { description: '路径可能还没生成，稍后再试' })
  }

  async function onReportNow(): Promise<void> {
    setIsReporting(true)
    try {
      const result = await reportPendingCrashes()
      if (result.reported > 0) {
        toast.success(`已上报 ${result.reported} 份崩溃现场`)
      } else if (result.kept > 0) {
        toast.warning(`上报未完成，仍有 ${result.kept} 份留在本地（网络恢复后下次启动会重试）`)
      } else {
        toast.info('没有待上报的崩溃现场')
      }
      await reload()
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      toast.error(`补报失败：${text}`)
    } finally {
      setIsReporting(false)
    }
  }

  const missingCore = tools?.tools.filter(function (tool) {
    return !tool.present && !tool.fullOnly
  })

  return (
    <div className={SURFACE_STACK}>
      <SettingsSection title="安装信息">
        <SettingsRow
          label="版本"
          hint={
            caps
              ? `${caps.identifier} · ${caps.platform}/${caps.arch}`
              : '非 Tauri 环境（浏览器预览）读不到本机信息'
          }>
          <span className="text-sm font-medium text-foreground">
            {caps?.appVersion ?? '—'}
          </span>
        </SettingsRow>

        <SettingsRow
          label="包档位"
          hint={
            caps?.variant === 'full'
              ? '包含 pandoc / ffmpeg / ffprobe，体积更大'
              : '默认精简版：只内置运行必需件，媒体/文档转换按需提示'
          }>
          <Badge variant={caps?.variant === 'full' ? 'default' : 'secondary'}>
            {variantLabel(caps?.variant)}
          </Badge>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="日志与诊断">
        <SettingsRow
          label="日志目录"
          hint={
            caps?.logDir
              ? `${caps.logDir} · 单文件上限 ${formatBytes(caps.logMaxFileSize)}`
              : '日志目录在应用数据目录下的 logs/'
          }>
          <Button
            variant="outline"
            size="sm"
            onClick={function () {
              void onOpen('log', '日志目录')
            }}>
            打开目录
          </Button>
        </SettingsRow>

        <SettingsRow
          label="崩溃现场"
          hint={
            caps
              ? `待上报 ${caps.pendingCrashCount} 份 · ${caps.crashDir ?? '—'}`
              : '待上报 0 份'
          }>
          <Button
            variant="outline"
            size="sm"
            onClick={function () {
              void onOpen('crash', '崩溃目录')
            }}>
            打开目录
          </Button>
        </SettingsRow>

        <SettingsRow
          label="会话状态"
          hint={
            caps?.sessionState === 'running'
              ? '本次会话进行中；异常退出会留下 crash 现场并在下次启动补报'
              : '没有正在记录的会话标记'
          }>
          <span className="text-xs text-muted-foreground">{caps?.sessionState ?? '—'}</span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="崩溃上报">
        <SettingsRow
          label="自动上报"
          hint="复用现有异常上报接口，只发送崩溃现场与日志尾巴，不含文档内容">
          <Switch
            checked={reportCrashes}
            onCheckedChange={function (checked) {
              void onToggleReport(checked)
            }}
          />
        </SettingsRow>

        <div className="flex flex-wrap items-center gap-2 py-1">
          <Button
            variant="outline"
            disabled={isReporting}
            onClick={function () {
              void onReportNow()
            }}>
            {isReporting ? '上报中…' : '立即补报'}
          </Button>
          <Button
            variant="ghost"
            disabled={isLoading}
            onClick={function () {
              void reload()
            }}>
            {isLoading ? '刷新中…' : '刷新'}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="完整版能力">
        {tools ? (
          <>
            <p className="pb-1 text-xs leading-snug text-muted-foreground">
              精简版不内置 pandoc / ffmpeg / ffprobe；下面按实际安装包逐项探测。
            </p>
            {tools.tools.map(function (tool) {
              const status = toolStatus(tool)
              return (
                <div
                  key={tool.key}
                  className="flex items-start justify-between gap-3 py-1">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm text-foreground">{tool.label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {tool.present ? (tool.version ?? tool.path ?? '已找到') : (tool.hint ?? '未找到')}
                    </span>
                  </div>
                  <Badge
                    variant={status.tone}
                    className="shrink-0">
                    {status.text}
                  </Badge>
                </div>
              )
            })}
            {missingCore && missingCore.length > 0 ? (
              <p className="pt-1 text-xs leading-snug text-destructive">
                必需件缺失（{missingCore.map((tool) => tool.label).join('、')}
                ），建议重新安装。
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {isLoading ? '正在探测…' : '探测失败，可在重装后重试'}
          </p>
        )}
      </SettingsSection>
    </div>
  )
}

export default DiagnosticSurface
