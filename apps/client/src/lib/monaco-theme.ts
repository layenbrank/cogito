/**
 * 代码编辑器主题：把设计 token 映射成 Monaco 主题。
 *
 * - Monaco 的主题色只吃 `#rrggbb` / `rgb()` / `rgba()`，`oklch()` 与 `color-mix()`
 *   必须先经 `features/window/css-color.ts` 解析
 * - 主题名固定为 `cogito-code`，切明暗只是重新 `defineTheme` 同一名字后 `setTheme`，
 *   避免留下两套可能过期的配色
 * - 主色跟随 `--primary`（用户可在外观设置里改），语法高亮用固定色板保证可读性
 */
import * as monaco from 'monaco-editor'

import {
  flattenColor,
  isDarkTheme,
  mixColor,
  resolveCssColor,
  withAlpha
} from '@/features/window/css-color.ts'

const CODE_THEME = 'cogito-code'

/** 语法色板：浅色 / 深色各一套，色相与应用主色族（蓝紫 + 青绿）对齐。 */
const SYNTAX_LIGHT: monaco.editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '#8b94a3', fontStyle: 'italic' },
  { token: 'keyword', foreground: '#7c3aed' },
  { token: 'keyword.control', foreground: '#7c3aed' },
  { token: 'operator', foreground: '#57606a' },
  { token: 'delimiter', foreground: '#57606a' },
  { token: 'string', foreground: '#0f7b4f' },
  { token: 'string.escape', foreground: '#b45309' },
  { token: 'number', foreground: '#b45309' },
  { token: 'regexp', foreground: '#b45309' },
  { token: 'constant', foreground: '#b45309' },
  { token: 'type', foreground: '#0e7490' },
  { token: 'type.identifier', foreground: '#0e7490' },
  { token: 'namespace', foreground: '#0e7490' },
  { token: 'function', foreground: '#1d4ed8' },
  { token: 'variable', foreground: '#1f2328' },
  { token: 'variable.predefined', foreground: '#9333ea' },
  { token: 'key', foreground: '#1d4ed8' },
  { token: 'tag', foreground: '#c2410c' },
  { token: 'attribute.name', foreground: '#7c3aed' },
  { token: 'attribute.value', foreground: '#0f7b4f' },
  { token: 'metatag', foreground: '#0e7490' },
  { token: 'invalid', foreground: '#b91c1c', fontStyle: 'underline' },
  { token: 'strong', fontStyle: 'bold' },
  { token: 'emphasis', fontStyle: 'italic' }
]

const SYNTAX_DARK: monaco.editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '#7d8590', fontStyle: 'italic' },
  { token: 'keyword', foreground: '#a78bfa' },
  { token: 'keyword.control', foreground: '#a78bfa' },
  { token: 'operator', foreground: '#9aa4b2' },
  { token: 'delimiter', foreground: '#9aa4b2' },
  { token: 'string', foreground: '#5ccf92' },
  { token: 'string.escape', foreground: '#e8b26a' },
  { token: 'number', foreground: '#e8b26a' },
  { token: 'regexp', foreground: '#e8b26a' },
  { token: 'constant', foreground: '#e8b26a' },
  { token: 'type', foreground: '#56d4dd' },
  { token: 'type.identifier', foreground: '#56d4dd' },
  { token: 'namespace', foreground: '#56d4dd' },
  { token: 'function', foreground: '#7aa2f7' },
  { token: 'variable', foreground: '#e6edf3' },
  { token: 'variable.predefined', foreground: '#d2a8ff' },
  { token: 'key', foreground: '#7aa2f7' },
  { token: 'tag', foreground: '#ffa657' },
  { token: 'attribute.name', foreground: '#a78bfa' },
  { token: 'attribute.value', foreground: '#5ccf92' },
  { token: 'metatag', foreground: '#56d4dd' },
  { token: 'invalid', foreground: '#ff7b72', fontStyle: 'underline' },
  { token: 'strong', fontStyle: 'bold' },
  { token: 'emphasis', fontStyle: 'italic' }
]

/** 当前明暗下解析出的一组基础色，其余颜色都由它们派生。 */
interface CodePalette {
  isDark: boolean
  background: string
  foreground: string
  muted: string
  border: string
  primary: string
  primaryForeground: string
  surface: string
  input: string
  success: string
  warning: string
  destructive: string
  brackets: string[]
}

function readPalette(): CodePalette {
  const isDark = isDarkTheme()
  const background = resolveCssColor('--background', isDark ? '#12161c' : '#ffffff')
  const foreground = resolveCssColor('--foreground', isDark ? '#e9eef5' : '#1f2328')
  return {
    isDark,
    background,
    foreground,
    muted: resolveCssColor('--muted-foreground', isDark ? '#8b949e' : '#656d76'),
    // `.dark` 下 --border 是半透明白，Monaco 需要实色
    border: flattenColor(resolveCssColor('--border', isDark ? '#2b3038' : '#e0e4e8'), background),
    primary: resolveCssColor('--primary', isDark ? '#4a5bd8' : '#5b3fe6'),
    primaryForeground: resolveCssColor('--primary-foreground', '#ffffff'),
    surface: mixColor(background, foreground, isDark ? 0.08 : 0.035),
    input: mixColor(background, foreground, isDark ? 0.13 : 0.05),
    success: resolveCssColor('--success', isDark ? '#4ade80' : '#0f7b4f'),
    warning: resolveCssColor('--warning', isDark ? '#e8b26a' : '#b45309'),
    destructive: resolveCssColor('--destructive', isDark ? '#ff7b72' : '#b91c1c'),
    brackets: [
      resolveCssColor('--chart-1', '#8091d2'),
      resolveCssColor('--chart-2', '#8b5cf6'),
      resolveCssColor('--chart-3', '#0e7490'),
      resolveCssColor('--chart-4', '#b45309'),
      resolveCssColor('--chart-5', '#0f7b4f'),
      resolveCssColor('--warning', '#c2410c')
    ]
  }
}

function buildColors(palette: CodePalette): Record<string, string> {
  const { background, foreground, muted, border, primary, surface } = palette
  const softBorder = withAlpha(foreground, palette.isDark ? 0.12 : 0.1)

  return {
    'editor.background': background,
    'editor.foreground': foreground,
    'foreground': foreground,
    'descriptionForeground': muted,
    'errorForeground': palette.destructive,
    'focusBorder': withAlpha(primary, 0.6),
    'textLink.foreground': primary,
    'textSeparator.foreground': withAlpha(foreground, 0.2),
    'badge.background': primary,
    'badge.foreground': palette.primaryForeground,

    'editorLineNumber.foreground': withAlpha(foreground, 0.38),
    'editorLineNumber.activeForeground': withAlpha(foreground, 0.78),
    'editorLineNumber.dimmedForeground': withAlpha(foreground, 0.2),
    'editorCursor.foreground': primary,
    'editorCursor.background': background,

    'editor.selectionBackground': withAlpha(primary, palette.isDark ? 0.34 : 0.18),
    'editor.inactiveSelectionBackground': withAlpha(primary, palette.isDark ? 0.16 : 0.1),
    'editor.selectionHighlightBackground': withAlpha(primary, 0.14),
    'editor.selectionHighlightBorder': withAlpha(primary, 0.3),
    'editor.wordHighlightBackground': withAlpha(primary, 0.12),
    'editor.wordHighlightStrongBackground': withAlpha(palette.success, 0.18),
    'editor.hoverHighlightBackground': withAlpha(primary, 0.1),
    'editor.lineHighlightBackground': withAlpha(foreground, palette.isDark ? 0.05 : 0.035),
    'editor.lineHighlightBorder': withAlpha(background, 0),
    'editor.rangeHighlightBackground': withAlpha(primary, 0.1),
    'editor.foldBackground': withAlpha(primary, 0.08),
    'editorWhitespace.foreground': withAlpha(foreground, 0.16),
    'editorIndentGuide.background1': withAlpha(foreground, 0.1),
    'editorIndentGuide.activeBackground1': withAlpha(primary, 0.35),
    'editorRuler.foreground': withAlpha(foreground, 0.08),
    'editorLink.activeForeground': primary,
    'editorGhostText.foreground': withAlpha(foreground, 0.4),

    'editor.findMatchBackground': withAlpha(palette.warning, 0.45),
    'editor.findMatchBorder': withAlpha(palette.warning, 0.7),
    'editor.findMatchHighlightBackground': withAlpha(palette.warning, 0.22),
    'editor.findMatchHighlightBorder': withAlpha(palette.warning, 0.35),
    'editor.findRangeHighlightBackground': withAlpha(primary, 0.12),
    'editorOverviewRuler.findMatchForeground': withAlpha(palette.warning, 0.85),

    'editorError.foreground': palette.destructive,
    'editorWarning.foreground': palette.warning,
    'editorInfo.foreground': primary,
    'editorError.border': withAlpha(palette.destructive, 0.3),
    'editorWarning.border': withAlpha(palette.warning, 0.3),
    'editorOverviewRuler.errorForeground': palette.destructive,
    'editorOverviewRuler.warningForeground': palette.warning,
    'editorOverviewRuler.border': withAlpha(foreground, 0.08),

    'editorGutter.background': withAlpha(background, 0),
    'editorGutter.addedBackground': palette.success,
    'editorGutter.modifiedBackground': primary,
    'editorGutter.deletedBackground': palette.destructive,
    'editorGutter.foldingControlForeground': withAlpha(foreground, 0.5),

    'editorStickyScroll.background': mixColor(background, foreground, palette.isDark ? 0.04 : 0.02),
    'editorStickyScrollHover.background': mixColor(background, foreground, 0.07),
    'editorStickyScroll.shadow': withAlpha('#000000', palette.isDark ? 0.4 : 0.08),

    'editorWidget.background': surface,
    'editorWidget.foreground': foreground,
    'editorWidget.border': border,
    'editorSuggestWidget.background': surface,
    'editorSuggestWidget.border': border,
    'editorSuggestWidget.foreground': foreground,
    'editorSuggestWidget.selectedBackground': withAlpha(primary, 0.2),
    'editorSuggestWidget.highlightForeground': primary,
    'editorHoverWidget.background': surface,
    'editorHoverWidget.border': border,
    'editorHoverWidget.foreground': foreground,
    'editorHoverWidget.statusBarBackground': mixColor(surface, foreground, 0.06),

    'input.background': palette.input,
    'input.foreground': foreground,
    'input.border': border,
    'input.placeholderForeground': withAlpha(foreground, 0.45),
    'inputOption.activeBackground': withAlpha(primary, 0.25),
    'inputOption.activeBorder': primary,
    'inputOption.activeForeground': foreground,
    'inputValidation.errorBackground': withAlpha(palette.destructive, 0.15),
    'inputValidation.errorBorder': palette.destructive,

    'list.hoverBackground': withAlpha(foreground, 0.06),
    'list.activeSelectionBackground': withAlpha(primary, 0.18),
    'list.activeSelectionForeground': foreground,
    'list.inactiveSelectionBackground': withAlpha(primary, 0.1),
    'list.highlightForeground': primary,
    'list.focusOutline': withAlpha(primary, 0.4),

    'widget.shadow': withAlpha('#000000', palette.isDark ? 0.45 : 0.12),
    'scrollbar.shadow': withAlpha('#000000', palette.isDark ? 0.3 : 0.1),
    'scrollbarSlider.background': withAlpha(foreground, 0.16),
    'scrollbarSlider.hoverBackground': withAlpha(foreground, 0.28),
    'scrollbarSlider.activeBackground': withAlpha(foreground, 0.4),

    'minimap.background': background,
    'minimapSlider.background': withAlpha(foreground, 0.1),
    'minimapSlider.hoverBackground': withAlpha(foreground, 0.18),
    'minimapSlider.activeBackground': withAlpha(foreground, 0.26),

    'menu.background': surface,
    'menu.foreground': foreground,
    'menu.border': border,
    'menu.selectionBackground': primary,
    'menu.selectionForeground': palette.primaryForeground,
    'menu.separatorBackground': softBorder,

    'diffEditor.insertedTextBackground': withAlpha(palette.success, 0.16),
    'diffEditor.removedTextBackground': withAlpha(palette.destructive, 0.16),
    'diffEditor.insertedLineBackground': withAlpha(palette.success, 0.08),
    'diffEditor.removedLineBackground': withAlpha(palette.destructive, 0.08),
    'diffEditor.insertedTextBorder': withAlpha(palette.success, 0.5),
    'diffEditor.removedTextBorder': withAlpha(palette.destructive, 0.5),
    'diffEditor.diagonalFill': withAlpha(foreground, 0.08),
    'diffEditorOverview.insertedForeground': palette.success,
    'diffEditorOverview.removedForeground': palette.destructive,

    ...buildBracketColors(palette)
  }
}

function buildBracketColors(palette: CodePalette): Record<string, string> {
  const colors: Record<string, string> = {}
  palette.brackets.forEach(function (color, index) {
    const slot = index + 1
    colors[`editorBracketHighlight.foreground${slot}`] = color
    colors[`editorBracketPairGuide.activeBackground${slot}`] = withAlpha(color, 0.4)
    colors[`editorBracketPairGuide.background${slot}`] = withAlpha(color, 0.18)
  })
  colors['editorBracketMatch.background'] = withAlpha(palette.brackets[0], 0.16)
  colors['editorBracketMatch.border'] = palette.brackets[0]
  return colors
}

/**
 * 重新定义并应用代码主题。切明暗或改主色后调用。
 * 需要在 DOM 挂载后执行（要读 `:root` / `.dark` 上的 token）。
 */
function syncCodeTheme(): void {
  try {
    const palette = readPalette()
    monaco.editor.defineTheme(CODE_THEME, {
      base: palette.isDark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: palette.isDark ? SYNTAX_DARK : SYNTAX_LIGHT,
      colors: buildColors(palette)
    })
    monaco.editor.setTheme(CODE_THEME)
  } catch (error) {
    // 主题色非法会让 Monaco 抛错并带崩整个视图，这里退回内置主题保命
    console.error('[code] 应用代码主题失败，回退内置主题', error)
    monaco.editor.setTheme(isDarkTheme() ? 'vs-dark' : 'vs')
  }
}

/**
 * 跟随应用外观：`.dark` 类与外置 token（`--primary` / `--radius`）都由
 * `features/window/appearance.ts` 写进根节点，所以同时观察 `class` 与 `style`。
 * 返回取消订阅函数。
 */
function watchCodeTheme(onApplied?: (isDark: boolean) => void): () => void {
  let frame = 0
  const observer = new MutationObserver(function () {
    if (frame) return
    frame = requestAnimationFrame(function () {
      frame = 0
      syncCodeTheme()
      onApplied?.(isDarkTheme())
    })
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style']
  })
  return function () {
    if (frame) cancelAnimationFrame(frame)
    observer.disconnect()
  }
}

export { CODE_THEME, syncCodeTheme, watchCodeTheme }
