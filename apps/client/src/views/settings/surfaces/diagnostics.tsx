import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@cogito/design/components/alert-dialog'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Switch } from '@cogito/design/components/switch'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { CHANNELS } from '@/shared/ipc/channels'
import { ensurePersist, findPref, patchPref } from '@/features/persist'
import {
  GET_SEARCH_FILE_INDEX,
  POST_SEARCH_FILE_INDEX_CANCEL,
  POST_SEARCH_FILE_INDEX_REBUILD,
  type FileIndexStatus
} from '@/apis/search'
import { cachePruneText, cacheSizeText, formatBytes } from '@/lib/diagnostics/cache-text'
import {
  DELETE_AGENT_CACHE,
  GET_AGENT_CACHE_INFO,
  GET_BUILD_INFO,
  GET_CAPABILITIES,
  GET_DIAGNOSTICS_CAPABILITIES,
  POST_DIAGNOSTICS_OPEN_DIR,
  POST_TOOLS_INSTALL,
  POST_TOOLS_REMOVE,
  type AgentCacheStats,
  type BuildInfo,
  type Capabilities,
  type DiagnosticsCapabilities,
  type ToolCapability,
  type ToolInstallProgress
} from '@/apis/diagnostics'
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
  // 用户显式下载的那份优先于随包那份（取用顺序同 Rust 侧）
  if (capability.installed) return { text: '已下载', tone: 'success' }
  if (capability.present) return { text: '已内置', tone: 'success' }
  // 能一键补装的不该说「需完整版」
  if (capability.fullOnly && capability.installable) return { text: '可下载', tone: 'secondary' }
  // 精简版缺「只有完整版才有」的件是设计如此，不该标红
  if (capability.fullOnly) return { text: '需完整版', tone: 'secondary' }
  return { text: '缺失', tone: 'destructive' }
}

/** 安装进度的用户文案：下载给百分比，解压没有百分比 */
function toolProgressText(progress: ToolInstallProgress): string {
  if (progress.phase === 'extract') return '解压并安装…'
  if (progress.total > 0) {
    const percent = Math.min(100, Math.round((progress.received / progress.total) * 100))
    return `下载中 ${percent}% · ${formatBytes(progress.received)} / ${formatBytes(progress.total)}`
  }
  return `下载中 · ${formatBytes(progress.received)}`
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 链接时间文案：本地时区的 `YYYY-MM-DD HH:mm:ss`，便于和构建日志对时间 */
function linkTimeText(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '读不到'
  const stamp = new Date(ms)
  if (Number.isNaN(stamp.getTime())) return '读不到'
  const pad = function (value: number): string {
    return String(value).padStart(2, '0')
  }
  const date = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`
  const time = `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}:${pad(stamp.getSeconds())}`
  return `${date} ${time}`
}

function indexStatusText(status: FileIndexStatus | null): string {
  if (!status) return '读取中…'
  if (status.state === 'scanning') return `正在建立 · 已遍历 ${status.scanned}`
  if (status.state === 'error') return status.message ?? '上次扫描失败'
  if (status.state === 'ready') return status.message ?? ''
  return '尚未建立'
}

/** 设置 → 诊断：能力自述 / 日志目录 / 崩溃补报开关。 */
function DiagnosticSurface() {
  const [caps, setCaps] = useState<DiagnosticsCapabilities | null>(null)
  const [tools, setTools] = useState<Capabilities | null>(null)
  const [reportCrashes, setReportCrashes] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [isReporting, setIsReporting] = useState(false)
  const [cache, setCache] = useState<AgentCacheStats | null>(null)
  const [build, setBuild] = useState<BuildInfo | null>(null)
  const [isClearingCache, setIsClearingCache] = useState(false)
  const [fileIndex, setFileIndex] = useState<FileIndexStatus | null>(null)
  /** 全盘重建的二次确认：误点一次就是几分钟的整盘扫描（低配机上整机都能被拖死） */
  const [rebuildOpen, setRebuildOpen] = useState(false)
  /** 安装进度（按包键）：`ffmpeg` / `ffprobe` 共享同一个包，所以按包键而不是能力键存 */
  const [installing, setInstalling] = useState<Record<string, ToolInstallProgress>>({})
  /** 正在安装 / 卸载的包键：按钮防重入 */
  const [toolBusy, setToolBusy] = useState<string | null>(null)
  /** 单飞：挂载、点「刷新」、清完缓存、补报后都可能同时触发 */
  const reloadInFlight = useRef(false)

  const reload = useCallback(async function reload(): Promise<void> {
    if (reloadInFlight.current) return
    reloadInFlight.current = true
    setIsLoading(true)
    // 四路探测各自落地：能力探测要起外部进程（最慢），不该把其它区块一起卡在「读取中」；
    // 失败时保留上一次的值，避免一次抖动把已有信息清空。
    const tasks = [
      GET_DIAGNOSTICS_CAPABILITIES().then(function (next) {
        if (next) setCaps(next)
      }),
      GET_CAPABILITIES().then(function (next) {
        if (next) setTools(next)
      }),
      GET_AGENT_CACHE_INFO().then(function (next) {
        if (next) setCache(next)
      }),
      GET_BUILD_INFO().then(function (next) {
        if (next) setBuild(next)
      })
    ]
    try {
      await Promise.allSettled(tasks)
    } finally {
      reloadInFlight.current = false
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

  // 文件索引状态：挂载时拉一次；之后只在「扫描中」轮询（1.5s），扫完自停。
  // 按 state 触发而不是挂载时一次性跑完 —— 否则点「重建索引」把本地状态置成 scanning 后
  // 没人再去拉进度，界面会永远停在「已遍历 0」。
  useEffect(
    function () {
      let cancelled = false
      void GET_SEARCH_FILE_INDEX()
        .then(function (next) {
          if (!cancelled) setFileIndex(next)
        })
        .catch(function (error: unknown) {
          if (!cancelled) console.warn('[settings.diagnostics] 读取文件索引状态失败', error)
        })
      return function () {
        cancelled = true
      }
    },
    []
  )

  useEffect(
    function () {
      if (fileIndex?.state !== 'scanning') return
      let cancelled = false
      let timer = 0

      function schedule(): void {
        timer = window.setTimeout(function () {
          void GET_SEARCH_FILE_INDEX()
            .then(function (next) {
              if (cancelled) return
              setFileIndex(next)
              if (next.state === 'scanning') schedule()
            })
            .catch(function (error: unknown) {
              if (!cancelled) console.warn('[settings.diagnostics] 读取文件索引状态失败', error)
            })
        }, 1_500)
      }

      schedule()
      return function () {
        cancelled = true
        window.clearTimeout(timer)
      }
    },
    [fileIndex?.state]
  )

  async function onRebuildFileIndex(): Promise<void> {
    try {
      await POST_SEARCH_FILE_INDEX_REBUILD()
      setFileIndex(function (prev) {
        return prev
          ? { ...prev, state: 'scanning', scanned: 0, message: null }
          : prev
      })
      toast.success('已开始重建文件索引')
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      toast.error(`重建索引失败：${text}`)
    }
  }

  async function onCancelFileIndex(): Promise<void> {
    try {
      await POST_SEARCH_FILE_INDEX_CANCEL()
      setFileIndex(function (prev) {
        return prev
          ? { ...prev, state: 'ready', message: '扫描已停止，索引可能不完整' }
          : prev
      })
      toast.success('已请求停止建立索引')
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      toast.error(`停止索引失败：${text}`)
    }
  }

  /** 在线工具安装进度：按包键存，两个能力行（ffmpeg / ffprobe）共享同一条 */
  useEffect(
    function () {
      let disposed = false
      let unlisten: (() => void) | undefined
      // 事件订阅留在视图层（`apis` 只负责 invoke）
      void listen<ToolInstallProgress>(CHANNELS.TOOLS.INSTALL_PROGRESS, function (event) {
        const progress = event.payload
        setInstalling(function (prev) {
          return { ...prev, [progress.key]: progress }
        })
      })
        .then(function (fn) {
          if (disposed) {
            fn()
            return
          }
          unlisten = fn
        })
        .catch(function (error: unknown) {
          console.warn('[settings.diagnostics] 订阅工具安装进度失败', error)
        })
      return function () {
        disposed = true
        unlisten?.()
      }
    },
    []
  )

  async function onInstallTool(tool: ToolCapability): Promise<void> {
    const key = tool.installKey
    if (!key) return
    setToolBusy(key)
    try {
      await POST_TOOLS_INSTALL(key)
      toast.success(`${tool.label} 已安装`)
    } catch (error) {
      toast.error(`${tool.label} 安装失败`, { description: toErrorMessage(error) })
    } finally {
      setToolBusy(null)
      setInstalling(function (prev) {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
    await reload()
  }

  async function onRemoveTool(tool: ToolCapability): Promise<void> {
    const key = tool.installKey
    if (!key) return
    setToolBusy(key)
    try {
      await POST_TOOLS_REMOVE(key)
      toast.success(`${tool.label} 已卸载`)
    } catch (error) {
      toast.error(`${tool.label} 卸载失败`, { description: toErrorMessage(error) })
    } finally {
      setToolBusy(null)
    }
    await reload()
  }

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
    const opened = await POST_DIAGNOSTICS_OPEN_DIR(kind)
    if (opened) {
      toast.success(`已打开${label}`, { description: opened })
      return
    }
    toast.error(`打不开${label}`, { description: '路径可能还没生成，稍后再试' })
  }

  async function onClearCache(): Promise<void> {
    setIsClearingCache(true)
    try {
      const freed = await DELETE_AGENT_CACHE()
      if (freed === null) {
        toast.error('清空失败：命令异常或不在 Tauri 环境')
        return
      }
      toast.success(`已清空 Agent 缓存（释放 ${formatBytes(freed)}）`)
      await reload()
    } finally {
      setIsClearingCache(false)
    }
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
      <SettingsSection title="文件索引">
        <SettingsRow
          label="全盘文件名搜索"
          hint="重建会清空索引后重新遍历所有磁盘，耗时与磁盘大小有关">
          {fileIndex?.state === 'scanning' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={function () {
                void onCancelFileIndex()
              }}>
              停止
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={function () {
                setRebuildOpen(true)
              }}>
              重建索引
            </Button>
          )}
        </SettingsRow>
        <SettingsRow
          label="索引状态"
          hint={indexStatusText(fileIndex)}>
          <span className="text-muted-foreground text-xs tabular-nums">
            {fileIndex ? `${fileIndex.indexed} 条` : '—'}
          </span>
        </SettingsRow>
        <AlertDialog
          open={rebuildOpen}
          onOpenChange={setRebuildOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>重建全盘文件索引？</AlertDialogTitle>
              <AlertDialogDescription>
                会先清空索引再重新遍历所有磁盘，期间磁盘 IO 很重（低配机可能明显变卡）。
                扫描过程中可以随时点「停止」，已建立的条目会保留。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={function () {
                  setRebuildOpen(false)
                  void onRebuildFileIndex()
                }}>
                开始重建
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SettingsSection>

      <SettingsSection title="安装信息">
        <SettingsRow
          label="版本"
          hint={
            caps ? `${caps.identifier} · ${caps.platform}/${caps.arch}` : '无本机信息'
          }>
          <span className="text-sm font-medium text-foreground">
            {caps?.appVersion ?? '—'}
          </span>
        </SettingsRow>

        <SettingsRow
          label="包档位"
          hint={caps?.variant === 'full' ? '含 pandoc、ffmpeg' : caps ? '仅运行必需件' : undefined}>
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
              : '应用数据 logs/'
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
          hint={caps?.sessionState === 'running' ? '异常退出下次补报' : undefined}>
          <span className="text-xs text-muted-foreground">{caps?.sessionState ?? '—'}</span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="运行中的宿主">
        <SettingsRow
          label="链接时间"
          hint={
            build
              ? `${build.exe} · 进程 ${build.pid}`
              : '读不到构建指纹'
          }>
          <span className="text-sm font-medium text-foreground">
            {linkTimeText(build?.exeModifiedMs)}
          </span>
        </SettingsRow>

        <SettingsRow label="构建档位">
          <Badge variant={build?.profile === 'release' ? 'default' : 'secondary'}>
            {build ? `${build.profile} · v${build.version}` : '—'}
          </Badge>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Agent 缓存">
        <SettingsRow
          label="Agent 缓存"
          hint={
            cache
              ? `${cacheSizeText(cache.bytes)} · ${cache.sessions} 个会话 · ${cache.path}${
                  cache.legacyPath ? ` · 旧目录 ${cache.legacyPath}` : ''
                }`
              : '默认保留 7 天'
          }>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {cache ? cacheSizeText(cache.bytes) : '—'}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={isClearingCache}
              onClick={function () {
                void onClearCache()
              }}>
              {isClearingCache ? '清理中…' : '清空'}
            </Button>
          </div>
        </SettingsRow>

        <SettingsRow
          label="自动清理"
          hint={cachePruneText(cache)}>
          <Badge variant="secondary">
            {cache && cache.maxBytes ? `上限 ${cacheSizeText(cache.maxBytes)}` : '默认 512 MB'}
          </Badge>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="崩溃上报">
        <SettingsRow
          label="自动上报"
          hint="不含文档内容">
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
            {tools.tools.map(function (tool) {
              const status = toolStatus(tool)
              // 进度 / 忙碌都按包键：ffmpeg 与 ffprobe 是同一个包
              const progress = tool.installKey ? installing[tool.installKey] : undefined
              const busy = tool.installKey ? toolBusy === tool.installKey : false
              return (
                <div
                  key={tool.key}
                  className="flex items-start justify-between gap-3 py-1">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm text-foreground">{tool.label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {progress
                        ? toolProgressText(progress)
                        : tool.present
                          ? (tool.version ?? tool.path ?? '已找到')
                          : (tool.hint ?? '未找到')}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={status.tone}>{status.text}</Badge>
                    {tool.installable && tool.installKey ? (
                      tool.installed ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={function () {
                            void onRemoveTool(tool)
                          }}>
                          卸载
                        </Button>
                      ) : tool.present ? null : (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={function () {
                            void onInstallTool(tool)
                          }}>
                          下载
                        </Button>
                      )
                    ) : null}
                  </div>
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
