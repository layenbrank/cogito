import { Icon } from '@iconify/react/offline'
import { Button } from '../components/button'
import { cn } from 'cn'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/select'
import type { ComponentProps, CSSProperties, HTMLAttributes } from 'react'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { BundledLanguage, ThemedToken } from 'shiki'
// 高亮器按需装配：全量 `shiki` 入口会把 347 种语法 + 全部主题静态打进产物
// （实测 8.95 MB，占整个 JS 的三分之一），而对话里真正常用的不到二十种。
// 这里换成 core + 逐语言动态 import：只有真的出现某种代码块，才去拿那份语法。
import githubDark from '@shikijs/themes/github-dark'
import githubLight from '@shikijs/themes/github-light'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'

// Shiki uses bitflags for font styles: 1=italic, 2=bold, 4=underline
// oxlint-disable-next-line eslint(no-bitwise)
const isItalic = (fontStyle: number | undefined) => fontStyle && fontStyle & 1
// oxlint-disable-next-line eslint(no-bitwise)
const isBold = (fontStyle: number | undefined) => fontStyle && fontStyle & 2
const isUnderline = (fontStyle: number | undefined) =>
  // oxlint-disable-next-line eslint(no-bitwise)
  fontStyle && fontStyle & 4

// Transform tokens to include pre-computed keys to avoid noArrayIndexKey lint
interface KeyedToken {
  token: ThemedToken
  key: string
}
interface KeyedLine {
  tokens: KeyedToken[]
  key: string
}

const addKeysToTokens = (lines: ThemedToken[][]): KeyedLine[] =>
  lines.map((line, lineIdx) => ({
    key: `line-${lineIdx}`,
    tokens: line.map((token, tokenIdx) => ({
      key: `line-${lineIdx}-${tokenIdx}`,
      token
    }))
  }))

// Token rendering component
const TokenSpan = ({ token }: { token: ThemedToken }) => (
  <span
    className="dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)]"
    style={
      {
        backgroundColor: token.bgColor,
        color: token.color,
        fontStyle: isItalic(token.fontStyle) ? 'italic' : undefined,
        fontWeight: isBold(token.fontStyle) ? 'bold' : undefined,
        textDecoration: isUnderline(token.fontStyle) ? 'underline' : undefined,
        ...token.htmlStyle
      } as CSSProperties
    }>
    {token.content}
  </span>
)

// Line number styles using CSS counters
const LINE_NUMBER_CLASSES = cn(
  'block',
  'before:content-[counter(line)]',
  'before:inline-block',
  'before:[counter-increment:line]',
  'before:w-8',
  'before:mr-4',
  'before:text-right',
  'before:text-muted-foreground/50',
  'before:font-mono',
  'before:select-none'
)

// Line rendering component
const LineSpan = ({
  keyedLine,
  showLineNumbers
}: {
  keyedLine: KeyedLine
  showLineNumbers: boolean
}) => (
  <span className={showLineNumbers ? LINE_NUMBER_CLASSES : 'block'}>
    {keyedLine.tokens.length === 0
      ? '\n'
      : keyedLine.tokens.map(({ token, key }) => (
          <TokenSpan
            key={key}
            token={token}
          />
        ))}
  </span>
)

// Types
type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string
  /** 未知语言会在高亮时回退到 `text` */
  language: BundledLanguage | string
  showLineNumbers?: boolean
  /** 默认 true；嵌在 Tool 参数/结果里可关，避免双层头 */
  showHeader?: boolean
  contentClassName?: string
}

interface TokenizedCode {
  tokens: ThemedToken[][]
  fg: string
  bg: string
}

interface CodeBlockContextType {
  code: string
}

// Context
const CodeBlockContext = createContext<CodeBlockContextType>({
  code: ''
})

interface ResolvedLanguage {
  highlighter: HighlighterCore
  /** 实际拿去分词的语言 id；不认识的语法回落成 `text` */
  lang: string
}

type CodeToTokensLang = Parameters<HighlighterCore['codeToTokens']>[1]['lang']
type LoadLanguageInput = Parameters<HighlighterCore['loadLanguage']>[0]

// 只收录「对话里真会出现」的语言：键名就是 `@shikijs/langs/<键>`，
// 别名（ts / js / yml …）在包里各有独立导出，直接各自懒加载即可，不用另维护别名表。
// 没收录的语言一律按纯文本渲染 —— 以前全量包里「有没有这个语法」是碰运气，
// 现在缺哪个补哪一行，代价只是多一个几 KB 的 chunk。
const LANG_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  typescript: () => import('@shikijs/langs/typescript'),
  ts: () => import('@shikijs/langs/ts'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  js: () => import('@shikijs/langs/js'),
  jsx: () => import('@shikijs/langs/jsx'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  yaml: () => import('@shikijs/langs/yaml'),
  yml: () => import('@shikijs/langs/yml'),
  toml: () => import('@shikijs/langs/toml'),
  ini: () => import('@shikijs/langs/ini'),
  dotenv: () => import('@shikijs/langs/dotenv'),
  csv: () => import('@shikijs/langs/csv'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  bash: () => import('@shikijs/langs/bash'),
  sh: () => import('@shikijs/langs/sh'),
  zsh: () => import('@shikijs/langs/zsh'),
  fish: () => import('@shikijs/langs/fish'),
  console: () => import('@shikijs/langs/console'),
  powershell: () => import('@shikijs/langs/powershell'),
  ps1: () => import('@shikijs/langs/ps1'),
  batch: () => import('@shikijs/langs/batch'),
  bat: () => import('@shikijs/langs/bat'),
  cmd: () => import('@shikijs/langs/cmd'),
  python: () => import('@shikijs/langs/python'),
  py: () => import('@shikijs/langs/py'),
  rust: () => import('@shikijs/langs/rust'),
  rs: () => import('@shikijs/langs/rs'),
  go: () => import('@shikijs/langs/go'),
  java: () => import('@shikijs/langs/java'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  kt: () => import('@shikijs/langs/kt'),
  scala: () => import('@shikijs/langs/scala'),
  swift: () => import('@shikijs/langs/swift'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  cs: () => import('@shikijs/langs/cs'),
  php: () => import('@shikijs/langs/php'),
  ruby: () => import('@shikijs/langs/ruby'),
  rb: () => import('@shikijs/langs/rb'),
  lua: () => import('@shikijs/langs/lua'),
  dart: () => import('@shikijs/langs/dart'),
  r: () => import('@shikijs/langs/r'),
  perl: () => import('@shikijs/langs/perl'),
  'objective-c': () => import('@shikijs/langs/objective-c'),
  objc: () => import('@shikijs/langs/objc'),
  elixir: () => import('@shikijs/langs/elixir'),
  haskell: () => import('@shikijs/langs/haskell'),
  clojure: () => import('@shikijs/langs/clojure'),
  zig: () => import('@shikijs/langs/zig'),
  julia: () => import('@shikijs/langs/julia'),
  solidity: () => import('@shikijs/langs/solidity'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  sass: () => import('@shikijs/langs/sass'),
  less: () => import('@shikijs/langs/less'),
  vue: () => import('@shikijs/langs/vue'),
  svelte: () => import('@shikijs/langs/svelte'),
  astro: () => import('@shikijs/langs/astro'),
  xml: () => import('@shikijs/langs/xml'),
  sql: () => import('@shikijs/langs/sql'),
  graphql: () => import('@shikijs/langs/graphql'),
  gql: () => import('@shikijs/langs/gql'),
  prisma: () => import('@shikijs/langs/prisma'),
  protobuf: () => import('@shikijs/langs/protobuf'),
  proto: () => import('@shikijs/langs/proto'),
  markdown: () => import('@shikijs/langs/markdown'),
  md: () => import('@shikijs/langs/md'),
  mdx: () => import('@shikijs/langs/mdx'),
  diff: () => import('@shikijs/langs/diff'),
  tex: () => import('@shikijs/langs/tex'),
  latex: () => import('@shikijs/langs/latex'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  docker: () => import('@shikijs/langs/docker'),
  makefile: () => import('@shikijs/langs/makefile'),
  make: () => import('@shikijs/langs/make'),
  cmake: () => import('@shikijs/langs/cmake'),
  nginx: () => import('@shikijs/langs/nginx'),
  hcl: () => import('@shikijs/langs/hcl'),
  terraform: () => import('@shikijs/langs/terraform'),
  tf: () => import('@shikijs/langs/tf'),
  nix: () => import('@shikijs/langs/nix'),
  'git-commit': () => import('@shikijs/langs/git-commit'),
  'git-rebase': () => import('@shikijs/langs/git-rebase'),
  http: () => import('@shikijs/langs/http'),
  regex: () => import('@shikijs/langs/regex')
}

// 同一个 core 高亮器，语法按需挂上去
const highlighterCache = new Map<string, Promise<ResolvedLanguage>>()

let coreHighlighter: Promise<HighlighterCore> | null = null
// 语法串行挂载：并发 loadLanguage 会各自解析内嵌依赖，串起来更稳
let langChain: Promise<unknown> = Promise.resolve()

// Token cache
const tokensCache = new Map<string, TokenizedCode>()
/** 缓存条数上限：切多少会话都不会无限增长 */
const TOKENS_CACHE_LIMIT = 40
/** 超过这个长度的代码不进缓存：一次分词结果本身就很吃内存，缓存下来只会加速 OOM */
const TOKENS_CACHE_MAX_CODE = 32_768

// Subscribers for async token updates
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>()

/**
 * 缓存键必须**覆盖全文**。
 *
 * 之前用「长度 + 首尾 100 字」做键：同长度、首尾相同的两段不同代码会命中彼此的
 * 分词结果（渲染出错误的颜色），而切过的会话越多，缓存越只增不减。
 * 用全文入键：字符串按引用存，不额外拷贝内容；容量由 TOKENS_CACHE_LIMIT 兑底。
 */
const getTokensCacheKey = (code: string, language: BundledLanguage) =>
  `${language}:${code}`

function rememberTokens(key: string, codeLength: number, tokenized: TokenizedCode): void {
  if (codeLength > TOKENS_CACHE_MAX_CODE) return
  tokensCache.set(key, tokenized)
  while (tokensCache.size > TOKENS_CACHE_LIMIT) {
    const oldest = tokensCache.keys().next().value
    if (oldest === undefined) break
    tokensCache.delete(oldest)
  }
}

/**
 * 分词是纯 CPU 工作；流式结束时多块代码会同时就绪，直接在同一帧里跑会堆成
 * 一次几百毫秒的长任务。排到空闲回调里逐个执行（无 requestIdleCallback 的环境兑底）。
 */
function runWhenIdle(task: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(
      function () {
        task()
      },
      { timeout: 500 }
    )
    return
  }
  window.setTimeout(task, 0)
}

// core 高亮器只装配一次：引擎（oniguruma wasm）与双主题，语法随后按语言挂上去。
// 引擎本身也走动态 import —— 它的 wasm 有 0.6 MB，首屏不该为「可能出现的代码块」付这笔钱。
function getCoreHighlighter(): Promise<HighlighterCore> {
  coreHighlighter ??= import('shiki/engine/oniguruma').then(({ createOnigurumaEngine }) =>
    createHighlighterCore({
      themes: [githubLight, githubDark],
      langs: [],
      engine: createOnigurumaEngine(import('shiki/wasm'))
    })
  )
  return coreHighlighter
}

const getHighlighter = (language: BundledLanguage): Promise<ResolvedLanguage> => {
  const key = String(language || 'text').toLowerCase()
  const cached = highlighterCache.get(key)
  if (cached) {
    return cached
  }

  const promise = getCoreHighlighter()
    .then(async (highlighter) => {
      const load = LANG_LOADERS[key]
      if (!load) {
        return { highlighter, lang: 'text' }
      }
      try {
        const grammar = (await load()).default as LoadLanguageInput
        const attach = () => highlighter.loadLanguage(grammar)
        // 上一份语法失败不该拖住这一份：两个分支都跑 attach，链本身不会变毒
        langChain = langChain.then(attach, attach)
        await langChain
        return { highlighter, lang: key }
      } catch (error) {
        // 语法包拉不下来就退回纯文本：代码块照样能读，只是没有颜色
        console.warn('[code-block] 语法加载失败，按纯文本渲染:', key, error)
        return { highlighter, lang: 'text' }
      }
    })
    .catch((error) => {
      // 高亮器本身都没装配起来（wasm 拉不到）就别把这个失败记进缓存
      highlighterCache.delete(key)
      throw error
    })

  highlighterCache.set(key, promise)
  return promise
}

// Create raw tokens for immediate display while highlighting loads
const createRawTokens = (code: string): TokenizedCode => ({
  bg: 'transparent',
  fg: 'inherit',
  tokens: code.split('\n').map((line) =>
    line === ''
      ? []
      : [
          {
            color: 'inherit',
            content: line
          } as ThemedToken
        ]
  )
})

// Synchronous highlight with callback for async results
export const highlightCode = (
  code: string,
  language: BundledLanguage,
  // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-callbacks)
  callback?: (result: TokenizedCode) => void
): TokenizedCode | null => {
  const tokensCacheKey = getTokensCacheKey(code, language)

  // Return cached result if available
  const cached = tokensCache.get(tokensCacheKey)
  if (cached) {
    return cached
  }

  // Subscribe callback if provided
  if (callback) {
    if (!subscribers.has(tokensCacheKey)) {
      subscribers.set(tokensCacheKey, new Set())
    }
    subscribers.get(tokensCacheKey)?.add(callback)
  }

  // Start highlighting in background - fire-and-forget async pattern
  getHighlighter(language)
    // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
    .then(({ highlighter, lang }) => {
      runWhenIdle(function () {
        const result = highlighter.codeToTokens(code, {
          lang: lang as CodeToTokensLang,
          themes: {
            dark: 'github-dark',
            light: 'github-light'
          }
        })

        const tokenized: TokenizedCode = {
          bg: result.bg ?? 'transparent',
          fg: result.fg ?? 'inherit',
          tokens: result.tokens
        }

        rememberTokens(tokensCacheKey, code.length, tokenized)

        // Notify all subscribers
        const subs = subscribers.get(tokensCacheKey)
        if (subs) {
          for (const sub of subs) {
            sub(tokenized)
          }
          subscribers.delete(tokensCacheKey)
        }
      })
    })
    // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then), eslint-plugin-promise(prefer-await-to-callbacks)
    .catch((error) => {
      console.error('Failed to highlight code:', error)
      subscribers.delete(tokensCacheKey)
    })

  return null
}

const CodeBlockBody = memo(
  ({
    tokenized,
    showLineNumbers,
    className
  }: {
    tokenized: TokenizedCode
    showLineNumbers: boolean
    className?: string
  }) => {
    const preStyle = useMemo(
      () => ({
        backgroundColor: tokenized.bg,
        color: tokenized.fg
      }),
      [tokenized.bg, tokenized.fg]
    )

    const keyedLines = useMemo(() => addKeysToTokens(tokenized.tokens), [tokenized.tokens])

    return (
      <pre
        className={cn(
          'dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)] m-0 p-4 text-sm',
          className
        )}
        style={preStyle}>
        <code
          className={cn(
            'font-mono text-sm',
            showLineNumbers && '[counter-increment:line_0] [counter-reset:line]'
          )}>
          {keyedLines.map((keyedLine) => (
            <LineSpan
              key={keyedLine.key}
              keyedLine={keyedLine}
              showLineNumbers={showLineNumbers}
            />
          ))}
        </code>
      </pre>
    )
  },
  (prevProps, nextProps) =>
    prevProps.tokenized === nextProps.tokenized &&
    prevProps.showLineNumbers === nextProps.showLineNumbers &&
    prevProps.className === nextProps.className
)

CodeBlockBody.displayName = 'CodeBlockBody'

export const CodeBlockContainer = ({
  className,
  language,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { language: string }) => (
  <div
    className={cn(
      'group relative w-full overflow-hidden rounded-lg border border-border/70 bg-card text-foreground shadow-xs',
      className
    )}
    data-language={language}
    style={{
      // 对话流式里 content-visibility 会用假高度估高，滚动条跟着抖
      contentVisibility: 'visible',
      ...style
    }}
    {...props}
  />
)

export const CodeBlockHeader = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="code-block-header"
    className={cn(
      // 头栏固定在块顶即可，勿对会话视口 sticky（会叠到下一块代码头上）
      'border-border/60 bg-muted/80 flex shrink-0 items-center justify-between border-b px-3 py-1.5 text-muted-foreground text-xs',
      className
    )}
    {...props}>
    {children}
  </div>
)

export const CodeBlockTitle = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex items-center gap-2', className)}
    {...props}>
    {children}
  </div>
)

export const CodeBlockFilename = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn('font-mono', className)}
    {...props}>
    {children}
  </span>
)

export const CodeBlockActions = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('-my-1 -mr-1 flex items-center gap-2', className)}
    {...props}>
    {children}
  </div>
)

export const CodeBlockContent = ({
  code,
  language,
  showLineNumbers = false,
  className
}: {
  code: string
  language: BundledLanguage | string
  showLineNumbers?: boolean
  className?: string
}) => {
  const lang = language as BundledLanguage
  // Memoized raw tokens for immediate display
  const rawTokens = useMemo(() => createRawTokens(code), [code])

  // Synchronous cache lookup — avoids setState in effect for cached results
  const syncTokens = useMemo(() => highlightCode(code, lang) ?? rawTokens, [code, lang, rawTokens])

  // Async highlighting result (populated after shiki loads)
  const [asyncTokens, setAsyncTokens] = useState<TokenizedCode | null>(null)
  const asyncKeyRef = useRef({ code, language: lang })

  // Invalidate stale async tokens synchronously during render
  if (asyncKeyRef.current.code !== code || asyncKeyRef.current.language !== lang) {
    asyncKeyRef.current = { code, language: lang }
    setAsyncTokens(null)
  }

  useEffect(() => {
    let cancelled = false

    highlightCode(code, lang, (result) => {
      if (!cancelled) {
        setAsyncTokens(result)
      }
    })

    return () => {
      cancelled = true
    }
  }, [code, lang])

  const tokenized = asyncTokens ?? syncTokens

  return (
    <div
      className={cn(
        'relative max-h-[min(36vh,20rem)] overflow-auto overscroll-y-contain',
        className
      )}>
      <CodeBlockBody
        showLineNumbers={showLineNumbers}
        tokenized={tokenized}
      />
    </div>
  )
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  showHeader = true,
  contentClassName,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const contextValue = useMemo(() => ({ code }), [code])

  return (
    <CodeBlockContext.Provider value={contextValue}>
      <CodeBlockContainer
        className={className}
        language={language}
        {...props}>
        {children}
        {!children && showHeader ? (
          <CodeBlockHeader>
            <CodeBlockTitle>
              <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-mono text-xs font-medium tracking-wide lowercase">
                {language || 'text'}
              </span>
            </CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockCopyButton />
            </CodeBlockActions>
          </CodeBlockHeader>
        ) : null}
        <CodeBlockContent
          code={code}
          language={language}
          showLineNumbers={showLineNumbers}
          className={contentClassName}
        />
      </CodeBlockContainer>
    </CodeBlockContext.Provider>
  )
}

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false)
  const timeoutRef = useRef<number>(0)
  const { code } = useContext(CodeBlockContext)

  const copyToClipboard = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) {
      onError?.(new Error('Clipboard API not available'))
      return
    }

    try {
      if (!isCopied) {
        await navigator.clipboard.writeText(code)
        setIsCopied(true)
        onCopy?.()
        timeoutRef.current = window.setTimeout(() => setIsCopied(false), timeout)
      }
    } catch (error) {
      onError?.(error as Error)
    }
  }, [code, onCopy, onError, timeout, isCopied])

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current)
    },
    []
  )

  const copiedIcon = isCopied ? 'lucide:check' : 'lucide:copy'

  return (
    <Button
      className={cn('shrink-0', className)}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}>
      {children ?? (
        <Icon
          icon={copiedIcon}
          className="size-3.5 shrink-0"
        />
      )}
    </Button>
  )
}

export type CodeBlockLanguageSelectorProps = ComponentProps<typeof Select>

export const CodeBlockLanguageSelector = (props: CodeBlockLanguageSelectorProps) => (
  <Select {...props} />
)

export type CodeBlockLanguageSelectorTriggerProps = ComponentProps<typeof SelectTrigger>

export const CodeBlockLanguageSelectorTrigger = ({
  className,
  ...props
}: CodeBlockLanguageSelectorTriggerProps) => (
  <SelectTrigger
    className={cn('h-7 border-none bg-transparent px-2 text-xs shadow-none', className)}
    size="sm"
    {...props}
  />
)

export type CodeBlockLanguageSelectorValueProps = ComponentProps<typeof SelectValue>

export const CodeBlockLanguageSelectorValue = (props: CodeBlockLanguageSelectorValueProps) => (
  <SelectValue {...props} />
)

export type CodeBlockLanguageSelectorContentProps = ComponentProps<typeof SelectContent>

export const CodeBlockLanguageSelectorContent = ({
  align = 'end',
  ...props
}: CodeBlockLanguageSelectorContentProps) => (
  <SelectContent
    align={align}
    {...props}
  />
)

export type CodeBlockLanguageSelectorItemProps = ComponentProps<typeof SelectItem>

export const CodeBlockLanguageSelectorItem = (props: CodeBlockLanguageSelectorItemProps) => (
  <SelectItem {...props} />
)
