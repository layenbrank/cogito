import { clsx } from 'clsx'

export type GlyphName =
  | 'search'
  | 'plus'
  | 'ellipsis'
  | 'bookmark'
  | 'settings'
  | 'grid'
  | 'folder'
  | 'arrow'
  | 'sparkles'
  | 'library'
  | 'terminal'

/** 单条或多条 path（多段弧线的 lucide 图标用数组） */
const PATHS: Record<Exclude<GlyphName, 'ellipsis'>, string | string[]> = {
  search: 'M21 21l-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z',
  plus: 'M12 5v14M5 12h14',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  // lucide:sparkles —— 主星 + 两个小十字，对齐 client agent 磁贴
  sparkles: [
    'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
    'M20 3v4',
    'M22 5h-4',
    'M4 17v2',
    'M5 18H3'
  ],
  // lucide:library —— 知识库磁贴
  library: ['m16 6 4 14', 'M12 6v14', 'M8 8v12', 'M4 4v16'],
  // lucide:terminal —— 代码磁贴
  terminal: ['m4 17 6-6-6-6', 'M12 19h8'],
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.7.9 1.2 1.6 1.4H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  arrow: 'M19 12H5M12 19l-7-7 7-7'
}

/** 页面上实际用到的几个图标，避免把整套图标库打进扩展 */
export function Glyph(props: { name: GlyphName; className?: string }) {
  const className = clsx('shrink-0', props.className ?? 'size-4')

  if (props.name === 'ellipsis') {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden>
        <circle cx="6" cy="12" r="1.4" fill="currentColor" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" />
        <circle cx="18" cy="12" r="1.4" fill="currentColor" />
      </svg>
    )
  }

  const paths = PATHS[props.name]
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden>
      {(Array.isArray(paths) ? paths : [paths]).map(function (path) {
        return (
          <path
            key={path}
            d={path}
          />
        )
      })}
    </svg>
  )
}
