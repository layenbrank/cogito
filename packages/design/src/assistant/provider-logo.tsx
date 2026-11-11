/**
 * Provider 品牌图标（对齐 assistant-ui `elements/logos`）
 *
 * 用途：模型选择器、模型设置表、接入卡片这些「一排接入放一起」的地方，
 * 用户扫一眼先认 logo 再读名字 —— 全是 lucide 六边形/方块时只能逐个读字。
 *
 * 数据在 `@cogito/shared` 的 `assets/icons/provider-logos.json`（simple-icons 子集，
 * 和 custom.json 一样是 Iconify 的 JSON）：完整 simple-icons 有 3000+ 图标，
 * 整包塞进构建不值得。要加品牌：从 `@iconify/json/json/simple-icons.json` 里摘对应
 * 条目追加进 icons。注册在 app 入口
 * （`addCollection(ProviderLogos)`），这里只负责「kind → 图标名」。
 *
 * 认不出的接回落 lucide 占位：宁可给一个能读的符号，也不给空白方块。
 */
import { Icon } from '@iconify/react/offline'

/** 精确匹配：接入 kind（也接受本地行 id 里常见的写法） */
const PROVIDER_LOGO: Record<string, string> = {
  openai: 'simple-icons:openai',
  anthropic: 'simple-icons:anthropic',
  claude: 'simple-icons:claude',
  google: 'simple-icons:googlegemini',
  'google-gemini': 'simple-icons:googlegemini',
  gemini: 'simple-icons:googlegemini',
  'gemini-cli': 'simple-icons:googlegemini',
  deepseek: 'simple-icons:deepseek',
  ollama: 'simple-icons:ollama',
  openrouter: 'simple-icons:openrouter',
  azure: 'simple-icons:microsoftazure',
  'azure-openai': 'simple-icons:microsoftazure',
  'azure-foundry': 'simple-icons:microsoftazure',
  bedrock: 'simple-icons:amazonwebservices',
  'aws-bedrock': 'simple-icons:amazonwebservices',
  alibaba: 'simple-icons:qwen',
  qwen: 'simple-icons:qwen',
  dashscope: 'simple-icons:alibabacloud',
  moonshot: 'simple-icons:moonshotai',
  'moonshot-ai': 'simple-icons:moonshotai',
  kimi: 'simple-icons:moonshotai',
  minimax: 'simple-icons:minimax',
  cursor: 'simple-icons:cursor',
  'cursor-agent': 'simple-icons:cursor',
  copilot: 'simple-icons:githubcopilot',
  'github-copilot': 'simple-icons:githubcopilot',
  mistral: 'simple-icons:mistralai',
  mistralai: 'simple-icons:mistralai'
}

/**
 * 模糊兜底：本地接入允许自定义 id（`custom-deepseek`、`my-gemini-key`），
 * 精确表落空时按品牌词再判一次 —— 顺序即优先级，越具体的放前面。
 */
const BRAND_HINTS: readonly (readonly [string, string])[] = [
  ['deepseek', 'simple-icons:deepseek'],
  ['anthropic', 'simple-icons:anthropic'],
  ['claude', 'simple-icons:claude'],
  ['openai', 'simple-icons:openai'],
  ['azure', 'simple-icons:microsoftazure'],
  ['bedrock', 'simple-icons:amazonwebservices'],
  ['gemini', 'simple-icons:googlegemini'],
  ['google', 'simple-icons:googlegemini'],
  ['openrouter', 'simple-icons:openrouter'],
  ['dashscope', 'simple-icons:alibabacloud'],
  ['qwen', 'simple-icons:qwen'],
  ['alibaba', 'simple-icons:qwen'],
  ['moonshot', 'simple-icons:moonshotai'],
  ['kimi', 'simple-icons:moonshotai'],
  ['minimax', 'simple-icons:minimax'],
  ['mistral', 'simple-icons:mistralai'],
  ['copilot', 'simple-icons:githubcopilot'],
  ['cursor', 'simple-icons:cursor'],
  ['ollama', 'simple-icons:ollama'],
  ['atomic', 'simple-icons:ollama']
]

/** 占位：没有品牌图标时的可读符号（沿用模型选择器原来的那套） */
function findPlaceholderIcon(key: string): string {
  if (key.includes('zhipu') || key.includes('glm')) return 'lucide:brain'
  if (key.includes('cogito') || key.includes('gateway')) return 'lucide:building-2'
  if (key.includes('avian') || key.includes('celeris')) return 'lucide:sparkles'
  if (key.includes('amp')) return 'lucide:terminal'
  return 'lucide:box'
}

/** 接入 kind / id → 图标名（品牌优先，认不出落 lucide） */
function findProviderLogoIcon(kind: string): string {
  const key = kind.trim().toLowerCase().replace(/_/g, '-')
  const exact = PROVIDER_LOGO[key]
  if (exact) return exact
  for (const pair of BRAND_HINTS) {
    if (key.includes(pair[0])) return pair[1]
  }
  return findPlaceholderIcon(key)
}

interface ProviderLogoProps {
  /** 接入 kind（`provider.kind || provider.id`） */
  kind: string
  /** 边长 px；品牌图标是方形视图，宽高一致 */
  size?: number
  className?: string
}

function ProviderLogo({ kind, size = 16, className }: ProviderLogoProps) {
  return (
    <Icon
      icon={findProviderLogoIcon(kind)}
      width={size}
      height={size}
      aria-hidden
      className={className}
    />
  )
}

export { findProviderLogoIcon, ProviderLogo }
export type { ProviderLogoProps }
