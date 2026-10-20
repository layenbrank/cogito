interface EmptyHintProps {
  description: string
}

/** 分类为空或搜索无结果：简单线稿加说明，对应旧版 Empty.PRESENTED_IMAGE_SIMPLE */
function EmptyHint(props: EmptyHintProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <svg
        aria-hidden
        viewBox="0 0 64 41"
        className="h-10 w-16 text-muted-foreground/50">
        <ellipse
          cx="32"
          cy="33"
          rx="32"
          ry="7"
          fill="currentColor"
          opacity="0.25"
        />
        <path
          d="M55 12.8 44.9 2.2A4 4 0 0 0 42 1H22a4 4 0 0 0-2.8 1.2L9 12.8V22h46V12.8Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path
          d="M41.6 16.2c0-1.3.9-2.2 2.2-2.2H55V22H9v-8h11.2c1.3 0 2.2.9 2.2 2.2v.4c0 1.3 1 2.4 2.3 2.4h14.6c1.3 0 2.3-1.1 2.3-2.4v-.4Z"
          fill="currentColor"
          opacity="0.35"
        />
      </svg>
      <span>{props.description}</span>
    </div>
  )
}

export type { EmptyHintProps }
export { EmptyHint }
