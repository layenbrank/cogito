import { addCollection } from '@iconify/react/offline'
import { createRoot } from 'react-dom/client'
import 'reflect-metadata'

import App from '@/App.tsx'
import { BootstrapFailure } from '@/components/fallback/bootstrap-failure.tsx'
import { ErrorBoundary } from '@/components/fallback/ErrorBoundary.tsx'
import { ensurePersist, ensureSecrets, findPref } from '@/features/persist'
import { hydrateAuthToken } from '@/utils/auth.ts'
import { watchActiveTenant } from '@/features/quota/tenant.ts'
import {
  bootstrapTerminalSessions,
  watchAgentTerminal,
  watchIdleClosed
} from '@/features/terminal/agent-tabs.ts'
import { adoptAppearance, watchAppearance } from '@/features/window/appearance'
import { adoptShellMode } from '@/features/window/shell-mode'
import { installLogBridge } from '@/lib/diagnostics/log-bridge.ts'
import { installLongTaskMonitor } from '@/lib/perf/longtask.ts'
import { installBrowserChipLabels } from '@/features/browser/chip-labels'
import { reportPendingCrashes } from '@/lib/diagnostics/crash-report.ts'
import { useDictStore } from '@/stores/dict'
import { installExceptionReporting, reportUnknown } from '@/utils/exception-report.ts'
import { analyzeWithAcp } from '@/views/knowledge/lib/ingest-acp-analyzer.ts'
import { preloadBindings } from '@/features/agent/acp/session-binding'
import { installSubagentRunner } from '@/features/agent/acp/subagent'
import { registerIngestAnalyzer } from '@/views/knowledge/lib/ingest-analyze.ts'
import { bootstrapIngestEnqueueBridge } from '@/views/knowledge/lib/ingest-enqueue-bridge.ts'
import '@/styles/tailwind.css'
import '@/styles/index.scss'

import ProviderLogos from '@cogito/shared/provider-logos.json'
import AntIconify from '@iconify/json/json/ant-design.json'
import LucideIconify from '@iconify/json/json/lucide.json'
import MDIconify from '@iconify/json/json/mdi.json'

/** React 生成 DOM id 的前缀，避免与页面既有 id 冲突 */
const IDENTIFIER_PREFIX = 'cogito'

addCollection(MDIconify)
addCollection(AntIconify)
addCollection(LucideIconify)
// 模型接入的品牌图标（simple-icons 子集，见 shared 的 assets/icons/provider-logos.json）
addCollection(ProviderLogos)

// 顺序要紧：先把 console/onerror 送进 Rust 日志，再装异常上报 ——
// 这样上报自身打的 warn 也会落在 logs/cogito.log 里
installLogBridge()
installBrowserChipLabels()
// 长任务观测：dev 打 warn、生产只计数（window.__cogitoPerf），必须在首屏之前装
installLongTaskMonitor()
installExceptionReporting()
// 右栏自载 / ?embedded=1：尽早打标，避免后续 bootstrap 误当主窗
adoptShellMode()

const rootElement = document.getElementById('root') as HTMLElement
const appRoot = createRoot(rootElement, {
  onCaughtError(error) {
    // 只打日志：ErrorBoundary / CaptureErrorBoundary / OverlayBoundary 已 reportUnknown
    console.error('Root caught an error:', error)
  },
  onUncaughtError(error) {
    console.error('Root caught an uncaught error:', error)
    reportUnknown(error, { kind: 'react.onUncaughtError' }, 'fatal')
  },
  onRecoverableError(error) {
    console.error('Root caught a recoverable error:', error)
    reportUnknown(error, { kind: 'react.onRecoverableError' }, 'warning')
  },
  identifierPrefix: IDENTIFIER_PREFIX
})

async function bootstrap() {
  try {
    await ensurePersist()
    await ensureSecrets()
    // 刷新 / 重启后把 Keyring 里的令牌唤回内存并通知订阅者。
    // 不做这一步的话：令牌还在，但 session store / 租户解析在模块加载时已经按
    // 「无令牌」跑完了初始化 —— 界面上就是「登录态丢了」。
    await hydrateAuthToken()
    adoptAppearance(findPref('window').appearance)
    watchAppearance()
    // agent 在右栏终端跑命令时，把 tab 和面板打开（用户总能看到它在做什么）
    watchAgentTerminal()
    // 闲置回收：会话被 Rust 关掉后把 tab 标成已退出（不再显示「运行中」）
    watchIdleClosed()
    // WebView 刷新后 tabs 空：从 Rust list 灌回存活会话
    void bootstrapTerminalSessions()
    // 会话 ↔ ACP 绑定（S9）：一次性把库里的绑定灌进内存缓存。恢复进行中回合时
    // 走的是同步 `recallBinding`，所以这步必须赶在用户点进会话之前完成；失败只
    // 会让「刷新后恢复」失效，不影响启动。
    void preloadBindings().then(function (count) {
      if (count > 0) console.info('[bootstrap] ACP 绑定预载', count)
    })
    // 子任务（S10）：Rust 任务板派下来的活在这里跑（子会话、审批一律拒绝）
    void installSubagentRunner().catch(function (error: unknown) {
      console.warn('[bootstrap] 子任务监听安装失败', error)
    })
    // 租户身份：登录 / 切账号后重新解析，好让请求带上 `X-Tenant-ID`（网关按它算配额归属）
    watchActiveTenant()
    // 知识库：全局注册 ACP ingest 分析器 + agent 入队桥（不依赖知识库页是否打开）
    registerIngestAnalyzer(analyzeWithAcp)
    void bootstrapIngestEnqueueBridge()
    // 状态字典：本地 seed 冷启动；有登录态再主动拉远端（无设置页，用户不可见/不可配）
    const dict = useDictStore.getState()
    void dict.bootstrap().then(function () {
      return dict.syncRemote()
    })

    // 最外层边界：`App` 函数体里的 hook（useKeyboard / useCaptureCommands /
    // useAutomationRunner）在 App 内部，只有从外面再包一层才能兜住它们的抛错。
    appRoot.render(
      <ErrorBoundary
        boundaryId="root"
        title="界面加载失败">
        <App />
      </ErrorBoundary>
    )

    // 崩溃补报放在首屏之后：读磁盘 + 发 HTTP，绝不能拖慢启动
    void reportPendingCrashes()
      .then(function (result) {
        if (result.reported > 0 || result.kept > 0) {
          console.info('[bootstrap] 崩溃补报', result)
        }
      })
      .catch(function (error: unknown) {
        console.warn('[bootstrap] 崩溃补报失败', error)
      })
  } catch (error) {
    // bootstrap 失败绝不能白屏：渲染极简致命页 + 上报
    console.error('[bootstrap] 初始化失败', error)
    reportUnknown(error, { kind: 'bootstrap' }, 'fatal')
    appRoot.render(<BootstrapFailure error={error} />)
  }
}

void bootstrap()
