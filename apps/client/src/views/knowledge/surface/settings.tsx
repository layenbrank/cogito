/**
 * Wiki 设置：分类与 llm_wiki `settings-view` 对齐（左类目 + 右内容）。
 * 视觉对齐 agent/settings：muted 壳 + 双白卡 + 扁平行。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Switch } from '@cogito/design/components/switch'
import { Textarea } from '@cogito/design/components/textarea'
import { clsx } from 'clsx'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import styles from '@/views/knowledge/surface/settings.module.scss'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useSettingsStore } from '@/stores/setting'
import {
  embeddingProbeFailurePatch,
  embeddingProbeSuccessPatch,
  patchEmbeddingConfig,
  planEmbeddingToggle,
  readEmbeddingConfig,
  type EmbeddingConfig
} from '@/views/knowledge/lib/embedding-config.ts'
import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import {
  enqueueDuplicateReviews,
  enrichWikiWikilinks,
  findDuplicateTitleGroups,
  pushFileHistory,
  readFileHistory,
  rebuildWikiIndex
} from '@/views/knowledge/lib/project-maintenance.ts'
import {
  patchMultimodalConfig,
  readMultimodalConfig,
  type MultimodalConfig
} from '@/views/knowledge/lib/multimodal-config.ts'
import { joinPath } from '@/views/knowledge/lib/path.ts'
import {
  patchPdfPipelineConfig,
  readPdfPipelineConfig,
  type PdfPipelineConfig
} from '@/views/knowledge/lib/pdf-pipeline-config.ts'
import {
  patchScheduledImportConfig,
  readScheduledImportConfig,
  type ScheduledImportConfig
} from '@/views/knowledge/lib/scheduled-import-config.ts'
import {
  refreshScheduledImport,
  runScheduledImportOnce
} from '@/views/knowledge/lib/scheduled-import.ts'
import { toast } from 'sonner'
import {
  MAX_USER_CONCURRENCY,
  SOURCE_WATCH_FILE_TYPE_GROUPS,
  patchSourceWatchConfig,
  readSourceWatchConfig,
  readWatchAllBases,
  writeWatchAllBases,
  type SourceWatchConfig
} from '@/views/knowledge/lib/source-watch-config.ts'
import {
  patchAnyTxtConfig,
  readAnyTxtConfig,
  type AnyTxtConfig
} from '@/views/knowledge/lib/anytxt-config.ts'
import { fetchClipDaemonStatus, type ClipDaemonStatus } from '@/views/knowledge/lib/clip-daemon.ts'
import {
  clearVectorIndex,
  countVectors,
  probeEmbeddingEndpoint
} from '@/views/knowledge/lib/vector-store.ts'
import {
  patchWebSearchConfig,
  readWebSearchConfig,
  type WebSearchConfig
} from '@/views/knowledge/lib/web-search-config.ts'
import {
  patchWikiApiConfig,
  readWikiApiConfig,
  syncWikiHttpRuntime,
  type WikiApiConfig
} from '@/views/knowledge/lib/wiki-api-config.ts'
import {
  patchWikiOutputConfig,
  readWikiOutputConfig,
  type WikiOutputConfig
} from '@/views/knowledge/lib/wiki-output-config.ts'
import { openEditorPath } from '@/views/knowledge/workspace/editor-context.ts'

type SettingsSectionId =
  | 'llm'
  | 'embedding'
  | 'multimodal'
  | 'web-search'
  | 'anytxt'
  | 'network'
  | 'source-watch'
  | 'scheduled-import'
  | 'mineru'
  | 'api-server'
  | 'output'
  | 'maintenance'

const SECTION_GROUPS: readonly {
  label: string
  items: readonly { id: SettingsSectionId; label: string; icon: string }[]
}[] = [
  {
    label: '模型',
    items: [
      { id: 'llm', label: 'LLM', icon: 'lucide:box' },
      { id: 'embedding', label: 'Embedding', icon: 'lucide:database' },
      { id: 'multimodal', label: '多模态', icon: 'lucide:images' }
    ]
  },
  {
    label: '连接',
    items: [
      { id: 'web-search', label: '网页搜索', icon: 'lucide:globe' },
      { id: 'anytxt', label: 'AnyTXT', icon: 'lucide:file-search' },
      { id: 'network', label: '网络', icon: 'lucide:cable' },
      { id: 'api-server', label: 'API / Clip', icon: 'lucide:server' }
    ]
  },
  {
    label: '流水线',
    items: [
      { id: 'source-watch', label: '源监听', icon: 'lucide:radar' },
      { id: 'scheduled-import', label: '定时导入', icon: 'lucide:calendar-clock' },
      { id: 'mineru', label: 'MinerU / PDF', icon: 'lucide:file-digit' },
      { id: 'output', label: '输出', icon: 'lucide:languages' }
    ]
  },
  {
    label: '库',
    items: [{ id: 'maintenance', label: '维护', icon: 'lucide:wrench' }]
  }
]

const SETTINGS_SECTION_KEY = 'knowledge.wiki.settings.section'

function readStoredSection(): SettingsSectionId {
  try {
    const raw = sessionStorage.getItem(SETTINGS_SECTION_KEY)
    if (!raw) return 'embedding'
    for (const group of SECTION_GROUPS) {
      for (const item of group.items) {
        if (item.id === raw) return item.id
      }
    }
  } catch (error) {
    console.warn('[settings] read section failed', error)
  }
  return 'embedding'
}

function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{props.label}</span>
      <div className={styles.rowBody}>
        <div className={styles.rowControls}>{props.children}</div>
        {props.hint ? <p className={styles.rowHint}>{props.hint}</p> : null}
      </div>
    </div>
  )
}

function SectionTitle(props: { title: string; description: string }) {
  return (
    <header className={styles.header}>
      <h2 className={styles.title}>{props.title}</h2>
      <p className={styles.desc}>{props.description}</p>
    </header>
  )
}

function SettingsPanel(props: { children: ReactNode }) {
  return <section className={styles.panel}>{props.children}</section>
}

function SettingsTab() {
  const [section, setSection] = useState<SettingsSectionId>(readStoredSection)
  const [embedding, setEmbedding] = useState<EmbeddingConfig>(() => readEmbeddingConfig())
  const [multimodal, setMultimodal] = useState<MultimodalConfig>(() => readMultimodalConfig())
  const [watchConfig, setWatchConfig] = useState<SourceWatchConfig>(() => readSourceWatchConfig())
  const [watchAllBases, setWatchAllBases] = useState(function () {
    return readWatchAllBases()
  })
  const [searchConfig, setSearchConfig] = useState<WebSearchConfig>(() => readWebSearchConfig())
  const [anytxtConfig, setAnytxtConfig] = useState<AnyTxtConfig>(() => readAnyTxtConfig())
  const [pdfConfig, setPdfConfig] = useState<PdfPipelineConfig>(() => readPdfPipelineConfig())
  const [apiConfig, setApiConfig] = useState<WikiApiConfig>(() => readWikiApiConfig())
  const [outputConfig, setOutputConfig] = useState<WikiOutputConfig>(() => readWikiOutputConfig())
  const [scheduled, setScheduled] = useState<ScheduledImportConfig>(() =>
    readScheduledImportConfig()
  )
  const [clipStatus, setClipStatus] = useState<ClipDaemonStatus | null>(null)
  const [vectorCount, setVectorCount] = useState<number | null>(null)
  const [excludeDirsText, setExcludeDirsText] = useState(function () {
    return readSourceWatchConfig().excludeDirs.join(', ')
  })
  const [excludeExtensionsText, setExcludeExtensionsText] = useState(function () {
    return readSourceWatchConfig().excludeExtensions.join(', ')
  })
  const [excludeGlobsText, setExcludeGlobsText] = useState(function () {
    return readSourceWatchConfig().excludeGlobs.join(', ')
  })
  const selectedExtensions = useMemo(
    function () {
      return new Set(watchConfig.includeExtensions)
    },
    [watchConfig.includeExtensions]
  )

  useEffect(function () {
    const watch = readSourceWatchConfig()
    setEmbedding(readEmbeddingConfig())
    setMultimodal(readMultimodalConfig())
    setWatchConfig(watch)
    setWatchAllBases(readWatchAllBases())
    setExcludeDirsText(watch.excludeDirs.join(', '))
    setExcludeExtensionsText(watch.excludeExtensions.join(', '))
    setExcludeGlobsText(watch.excludeGlobs.join(', '))
    setSearchConfig(readWebSearchConfig())
    setAnytxtConfig(readAnyTxtConfig())
    setPdfConfig(readPdfPipelineConfig())
    const wikiApi = readWikiApiConfig()
    setApiConfig(wikiApi)
    void syncWikiHttpRuntime(wikiApi)
    setOutputConfig(readWikiOutputConfig())
    setScheduled(readScheduledImportConfig())
  }, [])

  useEffect(
    function () {
      if (section !== 'api-server' && section !== 'embedding') return
      let cancelled = false
      if (section === 'api-server') {
        void fetchClipDaemonStatus().then(function (status) {
          if (!cancelled) setClipStatus(status)
        })
      }
      if (section === 'embedding' && readEmbeddingConfig().enabled) {
        // 只在已启用时统计：开关关着不该为了显示一个数字去碰 lancedb
        void countVectors().then(function (count) {
          if (!cancelled) setVectorCount(count)
        })
      }
      return function () {
        cancelled = true
      }
    },
    [section]
  )

  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const activeBaseID = useKnowledgeBaseStore(function (state) {
    return state.activeBaseID
  })
  const rescan = useKnowledgeBaseStore(function (state) {
    return state.rescan
  })
  const exportBundle = useKnowledgeBaseStore(function (state) {
    return state.exportBundle
  })
  const docs = useKnowledgeBaseStore(function (state) {
    return state.docs
  })
  const [probingEmbedding, setProbingEmbedding] = useState(false)

  const probeHint = embedding.lastProbe
    ? embedding.lastProbe.ok
      ? `上次探测通过（${embedding.lastProbe.dim ?? '?'} 维）`
      : `上次探测失败：${embedding.lastProbe.error ?? '未知错误'}`
    : '启用前会先探测一次端点，避免填错地址就整库 embedding'

  /**
   * 启用前先探测端点：失败就不落 `enabled=true`。
   * 旧版开关是「写 localStorage 就完事」，端点填错时下一次 ingest 会立刻
   * 全量 embedding 并卡死 —— 用户看到的就是「一点就炸」。
   */
  async function handleToggleEmbedding(checked: boolean): Promise<void> {
    const current = readEmbeddingConfig()
    const plan = planEmbeddingToggle({
      checked,
      endpoint: current.endpoint,
      probeBeforeEnable: current.probeBeforeEnable
    })
    if (plan.kind === 'disable') {
      setEmbedding(patchEmbeddingConfig({ enabled: false }))
      return
    }
    if (plan.kind === 'reject') {
      toast.error(plan.message)
      return
    }
    if (plan.kind === 'enable') {
      setEmbedding(patchEmbeddingConfig({ enabled: true }))
      return
    }
    setProbingEmbedding(true)
    try {
      const probe = await probeEmbeddingEndpoint(current)
      setEmbedding(patchEmbeddingConfig(embeddingProbeSuccessPatch(probe.dim, Date.now())))
      toast.success(`端点可用（${probe.dim} 维）`)
    } catch (error) {
      // 探测失败一律不落 enabled=true：端点不可达时开关不生效，只留一条失败记录
      patchEmbeddingConfig(embeddingProbeFailurePatch(error, Date.now()))
      setEmbedding(readEmbeddingConfig())
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`端点探测失败，未启用：${message}`)
    } finally {
      setProbingEmbedding(false)
    }
  }

  /** 显式刷新已索引向量数（不再在进入分区时隐式触发）。 */
  async function handleRefreshVectorCount(): Promise<void> {
    setVectorCount(null)
    setVectorCount(await countVectors())
  }

  /** 清空索引：换过模型必须走这里，否则 schema 维度对不上。 */
  async function handleClearVectorIndex(): Promise<void> {
    try {
      await clearVectorIndex()
      setVectorCount(0)
      toast.success('已清空向量索引')
    } catch (error) {
      toast.error(`清空失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 重建索引：清空 + 重新扫描库目录，后续 ingest 会按新模型重新写入。 */
  async function handleRebuildVectorIndex(): Promise<void> {
    try {
      await clearVectorIndex()
      setVectorCount(0)
      await rescan()
      toast.success('已清空并重新扫描，ingest 完成后会重新建索引')
    } catch (error) {
      toast.error(`重建失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const activeBase = bases.find(function (base) {
    return base.id === activeBaseID
  })

  const proxy = useSettingsStore(function (state) {
    return state.settings.proxy
  })
  const toUpdateSettings = useSettingsStore(function (state) {
    return state.toUpdate
  })

  const ingestItems = useIngestQueueStore(function (state) {
    return state.items
  })
  const bootstrapIngest = useIngestQueueStore(function (state) {
    return state.bootstrap
  })

  function clearIngestQueue() {
    try {
      localStorage.removeItem('knowledge.ingest.queue')
      bootstrapIngest()
    } catch (error) {
      console.error('[settings] clear ingest queue failed', error)
    }
  }

  function openSchemaFile(relative: string) {
    if (!activeBase?.rootPath) return
    openEditorPath(joinPath(activeBase.rootPath, relative))
  }

  function selectSection(next: SettingsSectionId) {
    setSection(next)
    try {
      sessionStorage.setItem(SETTINGS_SECTION_KEY, next)
    } catch (error) {
      console.warn('[settings] persist section failed', error)
    }
  }

  return (
    <div className={styles.shell}>
      <nav
        aria-label="Wiki 设置分类"
        className={styles.nav}>
        <div className={styles.navTop}>
          <p className={styles.navTitle}>Wiki 设置</p>
          <p className={styles.navSubtitle}>按分类调整流水线</p>
        </div>
        <div className={styles.navBody}>
          {SECTION_GROUPS.map(function (group) {
            return (
              <div
                key={group.label}
                className={styles.navGroup}>
                <p className={styles.navGroupLabel}>{group.label}</p>
                {group.items.map(function (item) {
                  const isActive = item.id === section
                  return (
                    <Button
                      key={item.id}
                      type="button"
                      size="sm"
                      variant="ghost"
                      data-active={isActive ? 'true' : 'false'}
                      className={clsx(styles.navItem, isActive && styles.navItemActive)}
                      onClick={function () {
                        selectSection(item.id)
                      }}>
                      <Icon
                        icon={item.icon}
                        className={styles.navItemIcon}
                      />
                      {item.label}
                    </Button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </nav>

      <div className={styles.main}>
        <ScrollArea className={styles.mainScroll}>
          <div className={styles.mainInner}>
          {section === 'llm' ? (
            <SettingsPanel>
              <SectionTitle
                title="LLM"
                description="对话 / Ingest 模型走全局 Agent（ACP）。此处打开 purpose / schema 供助手读取。"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs"
                  disabled={!activeBase}
                  onClick={function () {
                    openSchemaFile('purpose.md')
                  }}>
                  打开 purpose.md
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs"
                  disabled={!activeBase}
                  onClick={function () {
                    openSchemaFile('schema.md')
                  }}>
                  打开 schema.md
                </Button>
              </div>
              <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                Chat 与 Ingest 分流、Provider 预设请在全局 Agent / 模型设置中配置。
              </p>
            </SettingsPanel>
          ) : null}

          {section === 'embedding' ? (
            <SettingsPanel>
              <SectionTitle
                title="Embedding"
                description="可选向量检索，默认关闭。对齐 llm_wiki：OpenAI 兼容 /v1/embeddings。"
              />
              <Row label="启用">
                <Switch
                  checked={embedding.enabled}
                  disabled={probingEmbedding}
                  onCheckedChange={function (checked) {
                    void handleToggleEmbedding(checked)
                  }}
                />
              </Row>
              <Row
                label="持久层"
                hint="LanceDB 落在库目录 .cogito/lancedb">
                <Select
                  value={embedding.store}
                  onValueChange={function (value) {
                    if (value !== 'lancedb' && value !== 'json') return
                    setEmbedding(patchEmbeddingConfig({ store: value }))
                  }}>
                  <SelectTrigger
                    size="sm"
                    className="h-8 w-40 text-xs"
                    disabled={probingEmbedding}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lancedb">LanceDB</SelectItem>
                    <SelectItem value="json">JSON 回退</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
              <Row
                label="已索引向量"
                hint={probeHint}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {!embedding.enabled ? '—' : vectorCount === null ? '…' : vectorCount}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!embedding.enabled}
                    onClick={function () {
                      void handleRefreshVectorCount()
                    }}>
                    刷新
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!embedding.enabled}
                    onClick={function () {
                      void handleRebuildVectorIndex()
                    }}>
                    重建索引
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!embedding.enabled}
                    onClick={function () {
                      void handleClearVectorIndex()
                    }}>
                    清空索引
                  </Button>
                </div>
              </Row>
              <Row label="ingest 后自动 embed">
                <Switch
                  checked={embedding.embedOnIngest}
                  disabled={probingEmbedding}
                  onCheckedChange={function (checked) {
                    setEmbedding(patchEmbeddingConfig({ embedOnIngest: checked }))
                  }}
                />
              </Row>
              <Row label="端点">
                <Input
                  value={embedding.endpoint}
                  disabled={probingEmbedding}
                  className="h-8 w-56 text-xs"
                  placeholder="https://…/v1"
                  onChange={function (event) {
                    setEmbedding(patchEmbeddingConfig({ endpoint: event.target.value }))
                  }}
                />
              </Row>
              <Row label="API Key">
                <Input
                  type="password"
                  value={embedding.apiKey}
                  disabled={probingEmbedding}
                  className="h-8 w-56 text-xs"
                  onChange={function (event) {
                    setEmbedding(patchEmbeddingConfig({ apiKey: event.target.value }))
                  }}
                />
              </Row>
              <Row label="模型">
                <Input
                  value={embedding.model}
                  disabled={probingEmbedding}
                  className="h-8 w-56 text-xs"
                  onChange={function (event) {
                    setEmbedding(patchEmbeddingConfig({ model: event.target.value }))
                  }}
                />
              </Row>
              <Row label="分块字符">
                <Input
                  type="number"
                  min={200}
                  value={embedding.maxChunkChars}
                  disabled={probingEmbedding}
                  className="h-8 w-24 text-xs"
                  onChange={function (event) {
                    setEmbedding(
                      patchEmbeddingConfig({
                        maxChunkChars: Number(event.target.value) || 1200
                      })
                    )
                  }}
                />
              </Row>
              <Row label="重叠字符">
                <Input
                  type="number"
                  min={0}
                  value={embedding.overlapChunkChars}
                  disabled={probingEmbedding}
                  className="h-8 w-24 text-xs"
                  onChange={function (event) {
                    setEmbedding(
                      patchEmbeddingConfig({
                        overlapChunkChars: Number(event.target.value) || 0
                      })
                    )
                  }}
                />
              </Row>
            </SettingsPanel>
          ) : null}

          {section === 'multimodal' ? (
            <SettingsPanel>
              <SectionTitle
                title="多模态"
                description="PDF 内嵌图在 ingest 时做视觉描述（对齐 llm_wiki Multimodal）。"
              />
              <Row label="启用">
                <Switch
                  checked={multimodal.enabled}
                  onCheckedChange={function (checked) {
                    setMultimodal(patchMultimodalConfig({ enabled: checked }))
                  }}
                />
              </Row>
              <Row
                label="复用主 LLM"
                hint="关闭后可填独立视觉端点">
                <Switch
                  checked={multimodal.useMainLlm}
                  disabled={!multimodal.enabled}
                  onCheckedChange={function (checked) {
                    setMultimodal(patchMultimodalConfig({ useMainLlm: checked }))
                  }}
                />
              </Row>
              <Row label="端点">
                <Input
                  value={multimodal.endpoint}
                  disabled={!multimodal.enabled || multimodal.useMainLlm}
                  className="h-8 w-56 text-xs"
                  onChange={function (event) {
                    setMultimodal(patchMultimodalConfig({ endpoint: event.target.value }))
                  }}
                />
              </Row>
              <Row label="模型">
                <Input
                  value={multimodal.model}
                  disabled={!multimodal.enabled || multimodal.useMainLlm}
                  className="h-8 w-56 text-xs"
                  onChange={function (event) {
                    setMultimodal(patchMultimodalConfig({ model: event.target.value }))
                  }}
                />
              </Row>
            </SettingsPanel>
          ) : null}

          {section === 'web-search' ? (
            <SettingsPanel>
              <SectionTitle
                title="网页搜索"
                description="Deep Research：Tavily / SerpApi / SearXNG / Brave / Firecrawl / Bocha。"
              />
              <Row label="Provider">
                <Select
                  value={searchConfig.provider}
                  onValueChange={function (value) {
                    if (typeof value !== 'string') return
                    setSearchConfig(
                      patchWebSearchConfig({
                        provider: value as WebSearchConfig['provider']
                      })
                    )
                  }}>
                  <SelectTrigger
                    size="sm"
                    className="h-8 w-40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">关闭</SelectItem>
                    <SelectItem value="tavily">Tavily</SelectItem>
                    <SelectItem value="serpapi">SerpApi</SelectItem>
                    <SelectItem value="searxng">SearXNG</SelectItem>
                    <SelectItem value="brave">Brave</SelectItem>
                    <SelectItem value="firecrawl">Firecrawl</SelectItem>
                    <SelectItem value="bocha">Bocha</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
              <Row label="API Key">
                <Input
                  type="password"
                  value={searchConfig.apiKey}
                  disabled={searchConfig.provider === 'none'}
                  className="h-8 w-56 text-xs"
                  onChange={function (event) {
                    setSearchConfig(patchWebSearchConfig({ apiKey: event.target.value }))
                  }}
                />
              </Row>
              <Row label="端点">
                <Input
                  value={searchConfig.endpoint}
                  disabled={searchConfig.provider === 'none'}
                  className="h-8 w-56 text-xs"
                  placeholder="SearXNG / Firecrawl / Bocha URL"
                  onChange={function (event) {
                    setSearchConfig(patchWebSearchConfig({ endpoint: event.target.value }))
                  }}
                />
              </Row>
              <Row label="结果自动 ingest">
                <Switch
                  checked={searchConfig.autoIngest}
                  onCheckedChange={function (checked) {
                    setSearchConfig(patchWebSearchConfig({ autoIngest: checked }))
                  }}
                />
              </Row>
            </SettingsPanel>
          ) : null}

          {section === 'anytxt' ? (
            <SettingsPanel>
              <SectionTitle
                title="AnyTXT"
                description="Windows AnyTXT 本机全文检索（默认 127.0.0.1:9920 JSON-RPC），供 Deep Research 本地通道。"
              />
              <Row label="启用">
                <Switch
                  checked={anytxtConfig.enabled}
                  onCheckedChange={function (checked) {
                    setAnytxtConfig(patchAnyTxtConfig({ enabled: checked }))
                  }}
                />
              </Row>
              <Row label="Endpoint">
                <Input
                  value={anytxtConfig.endpoint}
                  disabled={!anytxtConfig.enabled}
                  className="h-8 w-56 text-xs"
                  placeholder="http://127.0.0.1:9920"
                  onChange={function (event) {
                    setAnytxtConfig(patchAnyTxtConfig({ endpoint: event.target.value }))
                  }}
                />
              </Row>
              <Row label="过滤目录">
                <Input
                  value={anytxtConfig.filterDir}
                  disabled={!anytxtConfig.enabled}
                  className="h-8 w-56 text-xs"
                  placeholder="可选，空=全盘索引范围"
                  onChange={function (event) {
                    setAnytxtConfig(patchAnyTxtConfig({ filterDir: event.target.value }))
                  }}
                />
              </Row>
              <Row label="扩展名">
                <Input
                  value={anytxtConfig.filterExt}
                  disabled={!anytxtConfig.enabled}
                  className="h-8 w-40 text-xs"
                  placeholder="*"
                  onChange={function (event) {
                    setAnytxtConfig(patchAnyTxtConfig({ filterExt: event.target.value }))
                  }}
                />
              </Row>
              <Row label="条数上限">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={anytxtConfig.limit}
                  disabled={!anytxtConfig.enabled}
                  className="h-8 w-24 text-xs"
                  onChange={function (event) {
                    setAnytxtConfig(
                      patchAnyTxtConfig({ limit: Number(event.target.value) || 20 })
                    )
                  }}
                />
              </Row>
            </SettingsPanel>
          ) : null}

          {section === 'network' ? (
            <SettingsPanel>
              <SectionTitle
                title="网络"
                description="出站代理写入 HTTP_PROXY / HTTPS_PROXY（与全局设置同步，热切换）。"
              />
              <Row label="启用代理">
                <Switch
                  checked={proxy.enabled}
                  onCheckedChange={function (checked) {
                    void toUpdateSettings('proxy', { enabled: checked })
                  }}
                />
              </Row>
              <Row label="代理 URL">
                <Input
                  value={proxy.url}
                  disabled={!proxy.enabled}
                  className="h-8 w-56 text-xs"
                  placeholder="http://127.0.0.1:7890"
                  onChange={function (event) {
                    void toUpdateSettings('proxy', { url: event.target.value })
                  }}
                />
              </Row>
              <Row label="绕过局域网">
                <Switch
                  checked={proxy.bypassLocal}
                  disabled={!proxy.enabled}
                  onCheckedChange={function (checked) {
                    void toUpdateSettings('proxy', { bypassLocal: checked })
                  }}
                />
              </Row>
              <Row label="接受无效证书">
                <Switch
                  checked={proxy.acceptInvalidCerts}
                  disabled={!proxy.enabled}
                  onCheckedChange={function (checked) {
                    void toUpdateSettings('proxy', { acceptInvalidCerts: checked })
                  }}
                />
              </Row>
            </SettingsPanel>
          ) : null}

          {section === 'source-watch' ? (
            <div className="space-y-4">
              <SettingsPanel>
                <SectionTitle
                  title="资料文件夹自动监控"
                  description="监控 raw/sources 的外部变化，并选择哪些文件允许自动进入提取队列。"
                />
                <Row
                  label="监控项目资料文件夹"
                  hint="刷新原文列表，并为 raw/sources 下新增或修改的允许文件创建提取任务。">
                  <Switch
                    checked={watchConfig.enabled}
                    onCheckedChange={function (checked) {
                      setWatchConfig(patchSourceWatchConfig({ enabled: checked }))
                    }}
                  />
                </Row>
                <Row
                  label="监控所有最近项目"
                  hint="持续监听已启用监控的知识库；后台变更写入对应库队列，打开该库后再执行。">
                  <Switch
                    checked={watchAllBases}
                    onCheckedChange={function (checked) {
                      writeWatchAllBases(checked)
                      setWatchAllBases(checked)
                    }}
                  />
                </Row>
                <Row
                  label="文档解析并发数"
                  hint="同时解析的文档上限；PDF 抽取内部仍可能串行。">
                  <Input
                    type="number"
                    min={1}
                    max={MAX_USER_CONCURRENCY}
                    value={watchConfig.parsingConcurrency}
                    disabled={!watchConfig.enabled}
                    className="h-8 w-24 text-xs"
                    onChange={function (event) {
                      setWatchConfig(
                        patchSourceWatchConfig({
                          parsingConcurrency: Number(event.target.value) || 1
                        })
                      )
                    }}
                  />
                </Row>
                <Row
                  label="资料提取并发数"
                  hint="同时准备原文的数量；越高越占模型与内存。">
                  <Input
                    type="number"
                    min={1}
                    max={MAX_USER_CONCURRENCY}
                    value={watchConfig.ingestConcurrency}
                    disabled={!watchConfig.enabled}
                    className="h-8 w-24 text-xs"
                    onChange={function (event) {
                      setWatchConfig(
                        patchSourceWatchConfig({
                          ingestConcurrency: Number(event.target.value) || 1
                        })
                      )
                    }}
                  />
                </Row>
                <Row
                  label="保留解析后的 Markdown"
                  hint="按 raw/sources 同结构保存到 raw/parsed。">
                  <Switch
                    checked={watchConfig.persistExtractedMarkdown}
                    disabled={!watchConfig.enabled}
                    onCheckedChange={function (checked) {
                      setWatchConfig(
                        patchSourceWatchConfig({ persistExtractedMarkdown: checked })
                      )
                    }}
                  />
                </Row>
                <Row
                  label="自动提取允许的原始资料"
                  hint="关闭后外部变更仍刷新文件树，但不自动创建提取任务。">
                  <Switch
                    checked={watchConfig.autoIngest}
                    disabled={!watchConfig.enabled}
                    onCheckedChange={function (checked) {
                      setWatchConfig(patchSourceWatchConfig({ autoIngest: checked }))
                    }}
                  />
                </Row>
              </SettingsPanel>

              <SettingsPanel>
                <SectionTitle
                  title="允许的文件类型"
                  description="常见文档类型默认开启。媒体、二进制、源码和配置类格式默认关闭，需要时再手动选择。"
                />
                <div className="space-y-3">
                  {SOURCE_WATCH_FILE_TYPE_GROUPS.map(function (group) {
                    return (
                      <div
                        key={group.id}
                        className="space-y-1.5">
                        <div className="text-muted-foreground text-xs font-medium">
                          {group.label}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {group.extensions.map(function (ext) {
                            const checked = selectedExtensions.has(ext)
                            return (
                              <label
                                key={ext}
                                className={clsx(
                                  'border-border/60 bg-background inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
                                  'hover:bg-muted/40',
                                  checked && 'border-primary/40 bg-primary/5',
                                  !watchConfig.enabled && 'cursor-not-allowed opacity-50'
                                )}>
                                <Checkbox
                                  checked={checked}
                                  disabled={!watchConfig.enabled}
                                  className="size-3.5"
                                  onCheckedChange={function (value) {
                                    const next = new Set(watchConfig.includeExtensions)
                                    if (value) next.add(ext)
                                    else next.delete(ext)
                                    setWatchConfig(
                                      patchSourceWatchConfig({
                                        includeExtensions: [...next].sort()
                                      })
                                    )
                                  }}
                                />
                                <span className="font-mono leading-none">.{ext}</span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </SettingsPanel>

              <SettingsPanel>
                <SectionTitle
                  title="排除与限制"
                  description="排除目录、扩展名、文件名模式，以及自动提取体积上限。"
                />
                <Row label="最大文件 (MB)">
                  <Input
                    type="number"
                    min={1}
                    max={4096}
                    value={watchConfig.maxFileSizeMb}
                    disabled={!watchConfig.enabled}
                    className="h-8 w-24 text-xs"
                    onChange={function (event) {
                      setWatchConfig(
                        patchSourceWatchConfig({
                          maxFileSizeMb: Number(event.target.value) || 1
                        })
                      )
                    }}
                  />
                </Row>
                <Row label="防抖 ms" hint="Tauri watch 合并短时连续事件。">
                  <Input
                    type="number"
                    min={200}
                    value={watchConfig.delayMs}
                    disabled={!watchConfig.enabled}
                    className="h-8 w-24 text-xs"
                    onChange={function (event) {
                      setWatchConfig(
                        patchSourceWatchConfig({
                          delayMs: Number(event.target.value) || 800
                        })
                      )
                    }}
                  />
                </Row>
                <div className="space-y-1.5 py-1.5">
                  <Label className="text-muted-foreground text-sm">排除文件夹</Label>
                  <Textarea
                    value={excludeDirsText}
                    disabled={!watchConfig.enabled}
                    rows={2}
                    className="text-xs"
                    placeholder=".git, node_modules, drafts"
                    onChange={function (event) {
                      setExcludeDirsText(event.target.value)
                    }}
                    onBlur={function () {
                      const excludeDirs = excludeDirsText
                        .split(/[,，\n]/)
                        .map(function (item) {
                          return item.trim()
                        })
                        .filter(Boolean)
                      setWatchConfig(patchSourceWatchConfig({ excludeDirs }))
                      setExcludeDirsText(readSourceWatchConfig().excludeDirs.join(', '))
                    }}
                  />
                </div>
                <div className="space-y-1.5 py-1.5">
                  <Label className="text-muted-foreground text-sm">排除扩展名</Label>
                  <Textarea
                    value={excludeExtensionsText}
                    disabled={!watchConfig.enabled}
                    rows={2}
                    className="text-xs"
                    placeholder="tmp, bak, exe, dll"
                    onChange={function (event) {
                      setExcludeExtensionsText(event.target.value)
                    }}
                    onBlur={function () {
                      const excludeExtensions = excludeExtensionsText
                        .split(/[,，\n]/)
                        .map(function (item) {
                          return item.trim()
                        })
                        .filter(Boolean)
                      setWatchConfig(patchSourceWatchConfig({ excludeExtensions }))
                      setExcludeExtensionsText(
                        readSourceWatchConfig().excludeExtensions.join(', ')
                      )
                    }}
                  />
                </div>
                <div className="space-y-1.5 py-1.5">
                  <Label className="text-muted-foreground text-sm">排除文件名模式</Label>
                  <Textarea
                    value={excludeGlobsText}
                    disabled={!watchConfig.enabled}
                    rows={2}
                    className="text-xs"
                    placeholder="*.draft.*, ~$*, .~lock.*#"
                    onChange={function (event) {
                      setExcludeGlobsText(event.target.value)
                    }}
                    onBlur={function () {
                      const excludeGlobs = excludeGlobsText
                        .split(/[,，\n]/)
                        .map(function (item) {
                          return item.trim()
                        })
                        .filter(Boolean)
                      setWatchConfig(patchSourceWatchConfig({ excludeGlobs }))
                      setExcludeGlobsText(readSourceWatchConfig().excludeGlobs.join(', '))
                    }}
                  />
                </div>
              </SettingsPanel>
            </div>
          ) : null}

          {section === 'scheduled-import' ? (
            <SettingsPanel>
              <SectionTitle
                title="定时导入"
                description="按间隔扫描目录写入 raw/sources 并入队；变更后立刻重挂定时器。"
              />
              <Row label="启用">
                <Switch
                  checked={scheduled.enabled}
                  onCheckedChange={function (checked) {
                    setScheduled(patchScheduledImportConfig({ enabled: checked }))
                    refreshScheduledImport()
                  }}
                />
              </Row>
              <Row label="目录">
                <Input
                  value={scheduled.path}
                  disabled={!scheduled.enabled}
                  className="h-8 w-56 text-xs"
                  placeholder="绝对路径"
                  onChange={function (event) {
                    setScheduled(patchScheduledImportConfig({ path: event.target.value }))
                  }}
                  onBlur={function () {
                    refreshScheduledImport()
                  }}
                />
              </Row>
              <Row label="间隔（分钟）">
                <Input
                  type="number"
                  min={5}
                  value={scheduled.intervalMinutes}
                  disabled={!scheduled.enabled}
                  className="h-8 w-24 text-xs"
                  onChange={function (event) {
                    setScheduled(
                      patchScheduledImportConfig({
                        intervalMinutes: Number(event.target.value) || 60
                      })
                    )
                  }}
                  onBlur={function () {
                    refreshScheduledImport()
                  }}
                />
              </Row>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  disabled={!scheduled.enabled || !activeBase}
                  onClick={function () {
                    if (!activeBase) return
                    void runScheduledImportOnce(activeBase.rootPath)
                      .then(function (count) {
                        toast.success(`已导入 ${count} 个文件`)
                      })
                      .catch(function (error) {
                        console.error('[scheduled-import] run once failed', error)
                        toast.error(
                          error instanceof Error ? error.message : '立即运行失败'
                        )
                      })
                  }}>
                  立即运行一次
                </Button>
              </div>
            </SettingsPanel>
          ) : null}

          {section === 'mineru' ? (
            <SettingsPanel>
              <SectionTitle
                title="MinerU / PDF"
                description="正文优先旁路同名 .md 或 MinerU；pdfium 为轻量占位（未绑 pdfium-render）。抽取图片会扫描 wiki/media 同 stem 文件供 caption。"
              />
              <Row label="后端">
                <Select
                  value={pdfConfig.backend}
                  onValueChange={function (value) {
                    if (typeof value !== 'string') return
                    setPdfConfig(
                      patchPdfPipelineConfig({
                        backend: value as PdfPipelineConfig['backend']
                      })
                    )
                  }}>
                  <SelectTrigger
                    size="sm"
                    className="h-8 w-44 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sidecar-md">旁路 .md</SelectItem>
                    <SelectItem value="pdfium">pdfium</SelectItem>
                    <SelectItem value="mineru">MinerU</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
              <Row
                label="MinerU 端点"
                hint="可预先填写；后端选 MinerU 时才会请求。">
                <Input
                  value={pdfConfig.mineruEndpoint}
                  className="h-8 w-56 text-xs"
                  placeholder="https://…/mineru"
                  onChange={function (event) {
                    setPdfConfig(patchPdfPipelineConfig({ mineruEndpoint: event.target.value }))
                  }}
                />
              </Row>
              <Row
                label="Token"
                hint="可选 Bearer；与端点一并保存，不依赖当前后端。">
                <Input
                  type="password"
                  value={pdfConfig.mineruToken}
                  className="h-8 w-56 text-xs"
                  placeholder="可选"
                  onChange={function (event) {
                    setPdfConfig(patchPdfPipelineConfig({ mineruToken: event.target.value }))
                  }}
                />
              </Row>
              <Row label="抽取图片">
                <Switch
                  checked={pdfConfig.extractImages}
                  onCheckedChange={function (checked) {
                    setPdfConfig(patchPdfPipelineConfig({ extractImages: checked }))
                  }}
                />
              </Row>
            </SettingsPanel>
          ) : null}

          {section === 'api-server' ? (
            <SettingsPanel>
              <SectionTitle
                title="API / Clip 守护"
                description="默认 127.0.0.1:19828；允许局域网时重绑 0.0.0.0。Clip /api/v1；MCP 侧车开关控制 ACP 是否注入 cogito-mcp。"
              />
              <div
                className={clsx(
                  styles.statusCard,
                  clipStatus?.running && styles.statusCardOk
                )}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={clsx(
                        styles.statusDot,
                        clipStatus?.running && styles.statusDotOk
                      )}
                    />
                    <p className="text-sm font-medium text-foreground">
                      Clip 守护 {clipStatus?.running ? '运行中' : '未运行'}
                    </p>
                  </div>
                  <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                    {clipStatus
                      ? clipStatus.running
                        ? `端口 ${clipStatus.port} · 剪藏 ${clipStatus.clipCount} · API ${
                            clipStatus.apiOk ? '可用' : '不可用'
                          }`
                        : clipStatus.detail || '守护进程未启动'
                      : '检测中…'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 text-xs"
                  onClick={function () {
                    void fetchClipDaemonStatus().then(setClipStatus)
                  }}>
                  刷新状态
                </Button>
              </div>
              <Row label="Wiki API 启用">
                <Switch
                  checked={apiConfig.enabled}
                  onCheckedChange={function (checked) {
                    setApiConfig(patchWikiApiConfig({ enabled: checked }))
                  }}
                />
              </Row>
              <Row label="本机免鉴权">
                <Switch
                  checked={apiConfig.allowUnauthenticated}
                  onCheckedChange={function (checked) {
                    setApiConfig(patchWikiApiConfig({ allowUnauthenticated: checked }))
                  }}
                />
              </Row>
              <Row
                label="允许局域网"
                hint="开启后绑定 0.0.0.0（热重绑端口）">
                <Switch
                  checked={apiConfig.allowLanAccess}
                  onCheckedChange={function (checked) {
                    setApiConfig(patchWikiApiConfig({ allowLanAccess: checked }))
                  }}
                />
              </Row>
              <Row
                label="MCP 侧车"
                hint="关闭后新 ACP 会话不注入 cogito-mcp">
                <Switch
                  checked={apiConfig.mcpEnabled}
                  onCheckedChange={function (checked) {
                    setApiConfig(patchWikiApiConfig({ mcpEnabled: checked }))
                  }}
                />
              </Row>
              <Row
                label="端口"
                hint="固定 19828，随守护进程绑定">
                <Input
                  type="number"
                  value={apiConfig.port}
                  disabled
                  readOnly
                  className="h-8 w-28 text-xs"
                />
              </Row>
              <Row label="Token">
                <Input
                  type="password"
                  value={apiConfig.token}
                  className="h-8 w-56 text-xs"
                  placeholder="可选 Bearer / x-api-token"
                  onChange={function (event) {
                    setApiConfig(patchWikiApiConfig({ token: event.target.value }))
                  }}
                />
              </Row>
              <div className={styles.metaBox}>
                <p className={styles.metaTitle}>端点</p>
                <ul className={styles.metaList}>
                  <li>GET /health — Clip 守护</li>
                  <li>POST /clip — 剪藏</li>
                  <li>GET /api/v1/health</li>
                  <li>GET /api/v1/bases</li>
                  <li>GET|POST /api/v1/search</li>
                </ul>
              </div>
            </SettingsPanel>
          ) : null}

          {section === 'output' ? (
            <SettingsPanel>
              <SectionTitle
                title="输出"
                description="Ingest / 生成正文的语言偏好（对齐 llm_wiki Output）。"
              />
              <Row label="AI 输出语言">
                <Select
                  value={outputConfig.language}
                  onValueChange={function (value) {
                    if (typeof value !== 'string') return
                    setOutputConfig(
                      patchWikiOutputConfig({
                        language: value as WikiOutputConfig['language']
                      })
                    )
                  }}>
                  <SelectTrigger
                    size="sm"
                    className="h-8 w-40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh-CN">中文</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="ja">日本語</SelectItem>
                    <SelectItem value="ko">한국어</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
            </SettingsPanel>
          ) : null}

          {section === 'maintenance' ? (
            <SettingsPanel>
              <SectionTitle
                title="维护"
                description="重建索引、导出、清空 ingest 队列。Wiki 写入直接入库，无待发布门禁。"
              />
              {activeBase ? (
                <p
                  className={styles.pathChip}
                  title={activeBase.rootPath}>
                  {activeBase.rootPath}
                </p>
              ) : null}
              <div className={styles.actions}>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs"
                  disabled={!activeBase}
                  onClick={function () {
                    void rescan()
                  }}>
                  重建 FTS / 扫描
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs"
                  disabled={!activeBase}
                  onClick={function () {
                    if (!activeBase) return
                    void rebuildWikiIndex({
                      rootPath: activeBase.rootPath,
                      pages: docs.map(function (doc) {
                        return { relative: doc.relPath, title: doc.title }
                      })
                    }).then(function () {
                      pushFileHistory('wiki/index.md', 'rebuild')
                      void rescan()
                    })
                  }}>
                  重建 wiki/index.md
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs"
                  disabled={!activeBase}
                  onClick={function () {
                    void exportBundle()
                  }}>
                  导出项目包 (zip)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={clearIngestQueue}>
                  清空 ingest ({ingestItems.length})
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs"
                  disabled={!activeBase}
                  onClick={function () {
                    const groups = findDuplicateTitleGroups(
                      docs.map(function (doc) {
                        return { relative: doc.relPath, title: doc.title }
                      })
                    )
                    const count = enqueueDuplicateReviews(groups)
                    toast.success(
                      groups.length === 0
                        ? '未发现重复标题'
                        : `已入审阅 ${count} 组重复标题`
                    )
                  }}>
                  扫描去重
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs"
                  disabled={!activeBase}
                  onClick={function () {
                    if (!activeBase) return
                    void enrichWikiWikilinks({
                      rootPath: activeBase.rootPath,
                      pages: docs.map(function (doc) {
                        return { relative: doc.relPath, title: doc.title }
                      })
                    })
                      .then(function (updated) {
                        toast.success(`已 enrich ${updated} 页 wikilink`)
                        if (updated > 0) void rescan()
                      })
                      .catch(function (error) {
                        console.error('[maintenance] enrich failed', error)
                        toast.error(
                          error instanceof Error ? error.message : 'enrich 失败'
                        )
                      })
                  }}>
                  Enrich wikilinks
                </Button>
              </div>
              <div className={styles.metaBox}>
                <p className={styles.metaTitle}>
                  文件历史（最近 {readFileHistory().length}）
                </p>
                <ul className={clsx(styles.metaList, 'max-h-28 overflow-y-auto overscroll-y-contain')}>
                  {readFileHistory()
                    .slice(0, 8)
                    .map(function (entry) {
                      return (
                        <li key={`${entry.path}-${entry.at}`}>
                          {new Date(entry.at).toLocaleString()} · {entry.path}
                          {entry.note ? ` · ${entry.note}` : ''}
                        </li>
                      )
                    })}
                </ul>
              </div>
            </SettingsPanel>
          ) : null}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

export { SettingsTab }
