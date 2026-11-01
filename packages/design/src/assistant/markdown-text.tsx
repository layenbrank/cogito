import { Icon } from '@iconify/react/offline'

import { useAuiState, type TextMessagePartProps } from '@assistant-ui/react'
import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  type SyntaxHighlighterProps,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock
} from '@assistant-ui/react-markdown'
import { type FC, lazy, memo, Suspense, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from 'cn'
import { useCopyToClipboard } from '../hooks/use-copy-to-clipboard'
import { useAssistantLabels } from './labels'
import { TooltipIconButton } from './tooltip-icon-button'

const LazyCodeBlock = lazy(function () {
  return import('./code-block').then(function (module) {
    return { default: module.CodeBlock }
  })
})

const PRE_CLASS =
  'aui-md-pre border-border/60 bg-card max-h-[min(36vh,20rem)] overflow-auto overscroll-y-contain rounded-t-none rounded-b-xl border border-t-0 p-3.5 font-mono text-sm leading-relaxed shadow-xs'

type MarkdownTextProps = Partial<TextMessagePartProps> & {
  components?: Parameters<typeof memoizeMarkdownComponents>[0]
}

const useShallowStable = <T extends Record<string, unknown> | undefined>(value: T): T => {
  const ref = useRef(value)
  if (value !== ref.current) {
    const prev = ref.current
    const stable =
      value !== undefined &&
      prev !== undefined &&
      Object.keys(prev).length === Object.keys(value).length &&
      Object.keys(value).every((key) => prev[key] === value[key])
    if (!stable) ref.current = value
  }
  return ref.current
}

const MarkdownTextImpl: FC<MarkdownTextProps> = ({ components }) => {
  const stableComponents = useShallowStable(components)
  const markdownComponents = useMemo(() => {
    if (!stableComponents) return defaultComponents
    return {
      ...defaultComponents,
      ...memoizeMarkdownComponents(stableComponents)
    }
  }, [stableComponents])

  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="aui-md"
      // 关闭逐字 reveal：chunk 到即渲染，避免打字机感
      smooth={false}
      components={markdownComponents}
    />
  )
}

export const MarkdownText = memo(MarkdownTextImpl)

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const labels = useAssistantLabels()
  const { isCopied, copyToClipboard } = useCopyToClipboard()
  function onCopy() {
    if (!code || isCopied) return
    copyToClipboard(code)
  }

  return (
    <div className="aui-code-header-root border-border/60 bg-muted/80 mt-4 flex items-center justify-between rounded-t-xl border border-b-0 px-3 py-1.5 text-xs">
      <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-mono text-xs font-medium tracking-wide lowercase">
        {language || 'text'}
      </span>
      <TooltipIconButton
        tooltip={labels.copy}
        onClick={onCopy}>
        {!isCopied && (
          <Icon
            icon="lucide:copy"
            className="fade-in animate-in duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]"
          />
        )}
        {isCopied && (
          <Icon
            icon="lucide:check"
            className="fade-in animate-in duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
          />
        )}
      </TooltipIconButton>
    </div>
  )
}

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        'aui-md-h1 mt-5 mb-2 scroll-m-20 text-xl font-semibold first:mt-0 last:mb-0',
        className
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        'aui-md-h2 mt-5 mb-2 scroll-m-20 text-lg font-semibold first:mt-0 last:mb-0',
        className
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        'aui-md-h3 mt-4 mb-1.5 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0',
        className
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        'aui-md-h4 mt-3.5 mb-1 scroll-m-20 text-base font-medium first:mt-0 last:mb-0',
        className
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn('aui-md-h5 mt-3 mb-1 text-sm font-semibold first:mt-0 last:mb-0', className)}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn('aui-md-h6 mt-3 mb-1 text-sm font-medium first:mt-0 last:mb-0', className)}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={cn('aui-md-p my-3 leading-7 first:mt-0 last:mb-0', className)}
      {...props}
    />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn(
        'aui-md-a text-primary hover:text-primary/80 underline underline-offset-2',
        className
      )}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        'aui-md-blockquote border-muted-foreground/30 text-muted-foreground my-3 border-s-2 ps-4',
        className
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        'aui-md-ul marker:text-muted-foreground my-3 ms-5 list-disc [&>li]:mt-1',
        className
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        'aui-md-ol marker:text-muted-foreground my-3 ms-5 list-decimal [&>li]:mt-1',
        className
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr
      className={cn('aui-md-hr border-muted-foreground/20 my-3', className)}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="aui-md-table-wrapper my-3 overflow-x-auto">
      <table
        className={cn('aui-md-table w-full border-separate border-spacing-0', className)}
        {...props}
      />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        'aui-md-th bg-muted px-3 py-1.5 text-start font-medium first:rounded-ss-lg last:rounded-se-lg [[align=center]]:text-center [[align=right]]:text-right',
        className
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        'aui-md-td border-muted-foreground/20 border-s border-b px-3 py-1.5 text-start last:border-e [[align=center]]:text-center [[align=right]]:text-right',
        className
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }) => (
    <tr
      className={cn(
        'aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg',
        className
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li
      className={cn('aui-md-li leading-relaxed', className)}
      {...props}
    />
  ),
  strong: ({ className, ...props }) => (
    <strong
      className={cn('aui-md-strong font-semibold', className)}
      {...props}
    />
  ),
  sup: ({ className, ...props }) => (
    <sup
      className={cn('aui-md-sup [&>a]:text-xs [&>a]:no-underline', className)}
      {...props}
    />
  ),
  SyntaxHighlighter: function MarkdownSyntaxHighlighter({
    code,
    language,
    components
  }: SyntaxHighlighterProps) {
    const Pre = components.Pre
    const Code = components.Code
    // 流式中不做 shiki：每 token 高亮会拖垮主线程并推高滚动条抖动
    const isRunning = useAuiState(function (state) {
      return state.message.status?.type === 'running'
    })
    if (isRunning) {
      return (
        <Pre className={PRE_CLASS}>
          <Code>{code}</Code>
        </Pre>
      )
    }
    return (
      <Suspense
        fallback={
          <Pre className={PRE_CLASS}>
            <Code>{code}</Code>
          </Pre>
        }>
        <LazyCodeBlock
          code={code}
          language={language || 'text'}
          showHeader={false}
          className="aui-md-pre my-0 rounded-t-none rounded-b-xl border-t-0"
        />
      </Suspense>
    )
  },
  pre: ({ className, ...props }) => (
    <pre
      className={cn(PRE_CLASS, className)}
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock()
    return (
      <code
        className={cn(
          !isCodeBlock &&
            'aui-md-inline-code bg-muted rounded-md px-1.5 py-0.5 font-mono text-[0.85em]',
          className
        )}
        {...props}
      />
    )
  },
  CodeHeader
})

/**
 * 静态 markdown 渲染：给「不是消息 part」的场景复用同一套组件样式
 * （右栏的计划正文、说明文档等）。
 */
export const MarkdownContent = memo(function MarkdownContent(props: {
  markdown: string
  className?: string
}) {
  return (
    <div className={cn('aui-md', props.className ?? 'text-sm')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={defaultComponents}>
        {props.markdown}
      </ReactMarkdown>
    </div>
  )
})
