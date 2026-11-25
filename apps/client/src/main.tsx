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
import { adoptShellMode, isEmbeddedShell } from '@/features/window/shell-mode'
import {
  adoptMirrorWallSnapshot,
  startPublishingMirrorWall
} from '@/features/window/preview-snapshot'
import { installLogBridge } from '@/lib/diagnostics/log-bridge.ts'
import { installLongTaskMonitor } from '@/lib/perf/longtask.ts'
import { installBrowserChipLabels } from '@/features/browser/chip-labels'
import { reportPendingCrashes } from '@/lib/diagnostics/crash-report.ts'
import { useDictStore } from '@/stores/dict'
import { installExceptionReporting, reportUnknown } from '@/utils/exception-report.ts'
import { analyzeWithAcp } from '@/views/knowledge/lib/ingest-acp-analyzer.ts'
import { GET_ACP_BINDINGS } from '@/features/agent/acp/session-binding'
import { installSubagentRunner } from '@/features/agent/acp/subagent'
import { registerIngestAnalyzer } from '@/views/knowledge/lib/ingest-analyze.ts'
import { bootstrapIngestEnqueueBridge } from '@/views/knowledge/lib/ingest-enqueue-bridge.ts'
import { bootstrapWikiApiConfig } from '@/views/knowledge/lib/wiki-api-config.ts'
import { bootstrapWikiContextBridge } from '@/views/knowledge/lib/wiki-context-bridge.ts'
import '@/styles/tailwind.css'
import '@/styles/index.scss'

import ProviderLogos from '@cogito/shared/provider-logos.json'
// 图标子集：只含仓库真正引用的那几个图标（`pnpm icons` 生成，139 KB 左右）。
// 这里曾经整包 addCollection 三套官方全集（mdi + ant-design + lucide ≈ 4.5 MB JSON），
// 全部落在启动路径上：首帧要等几千个用不到的图标下载、解析。
import IconSubset from '@/assets/iconify-subset.json'

/** React 生成 DOM id 的前缀，避免与页面既有 id 冲突 */
const IDENTIFIER_PREFIX = 'cogito'

for (const collection of IconSubset) {
  addCollection(collection as unknown as Parameters<typeof addCollection>[0])
}
// 模型接入的品牌图标（simple-icons 子集，见 shared 的 assets/icons/provider-logos.json）
addCollection(ProviderLogos)

// 顺序要紧：先把 console/onerror 送进 Rust 日志，再装异常上报 ——
// 这样上报自身打的 warn 也会落在 logs/cogito.log 里
//
// 但这两件事都要走 Tauri 命令（`diagnostics:append` / `plugin:http|fetch`），
// 右栏自载的嵌套壳没有任何 IPC，装了只会整片撞 ACL。所以先认壳模式再决定：
// 嵌套壳里日志留在控制台、不接 Rust 日志桥，也不做异常上报。
adoptShellMode()
const isEmbeddedShellMode = isEmbeddedShell()
if (!isEmbeddedShellMode) {
  installLogBridge()
  installExceptionReporting()
}
installBrowserChipLabels()
// 长任务观测：dev 打 warn、生产只计数（window.__cogitoPerf），必须在首屏之前装
installLongTaskMonitor()

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

function renderApp() {
  appRoot.render(
    <ErrorBoundary
      boundaryId="root"
      title="界面加载失败">
      <App />
    </ErrorBoundary>
  )
}

async function bootstrap() {
  // 右栏自载 / `?embedded=1`：这是**降级壳**。
  // 右栏子 webview 不配 capability `remote.urls`（见 src-tauri/src/browser/mod.rs 的
  // 安全边界），一条 Tauri 命令都调不通。主窗那套 bootstrap（persist / Keyring /
  // 外观 / 终端 / 字典 / 崩溃补报）在这里只会刷屏 ACL 报错，所以整段跳过 ——
  // 界面照常渲染，只是不加载 IPC 数据（镜像磁贴、会话、终端这些都来自 Rust）。
  if (isEmbeddedShellMode) {
    // 墙面数据走「主窗写同源 localStorage、这里只读」的桥（见 preview-snapshot.ts）：
    // 没有 IPC 也能看到磁贴，但任何写操作仍会失败（预览不该能改库）。
    adoptMirrorWallSnapshot()
    renderApp()
    return
  }

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
    void GET_ACP_BINDINGS().then(function (count) {
      if (count > 0) console.info('[bootstrap] ACP 绑定预载', count)
    })
    // 子任务（S10）：Rust 任务板派下来的活在这里跑（子会话、审批一律拒绝）
    void installSubagentRunner().catch(function (error: unknown) {
      console.warn('[bootstrap] 子任务监听安装失败', error)
    })
    // 租户身份：登录 / 切账号后重新解析，好让请求带上 `X-Tenant-ID`（网关按它算配额归属）
    watchActiveTenant()
    // 本机 API / agent 代理开关：Rust 侧只是进程内状态，重启后要从设置里灌回去
    bootstrapWikiApiConfig()
    // 知识库：全局注册 ACP ingest 分析器 + agent 入队桥（不依赖知识库页是否打开）
    registerIngestAnalyzer(analyzeWithAcp)
    void bootstrapIngestEnqueueBridge().catch(function (error: unknown) {
      console.warn('[bootstrap] ingest 入队桥安装失败', error)
    })
    // 知识库说明书：聊天页要在没打开知识库时也能拿到 purpose/schema/overview
    bootstrapWikiContextBridge()
    // 状态字典：本地 seed 冷启动；有登录态再主动拉远端（无设置页，用户不可见/不可配）
    const dict = useDictStore.getState()
    void dict.bootstrap().then(function () {
      return dict.syncRemote()
    })

    // 右栏自载预览没有 IPC：把墙面快照发布到同源 localStorage / dev 中继，嵌套壳只读渲染
    // （挂在这里而不是路由里 —— 不依赖 AppHost 是否已经挂载）。
    // 发布器内部只认真主窗：overlay 窗也跑这段 bootstrap，但它从不初始化镜像
    // store，发出去的是一面空墙，会把预览端盖成空的。
    startPublishingMirrorWall()

    // 最外层边界：`App` 函数体里的 hook（useKeyboard / useCaptureCommands /
    // useAutomationRunner）在 App 内部，只有从外面再包一层才能兜住它们的抛错。
    renderApp()

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
