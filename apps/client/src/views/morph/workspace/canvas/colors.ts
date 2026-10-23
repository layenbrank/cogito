/** Canvas annotation colors (Konva needs resolved hex, not CSS vars) */
const PRIMARY = '#1677ff'
const ERROR = '#ff4d4f'
const HIGHLIGHT = '#FFE066'

const SELECTION_STROKE = PRIMARY

const DEFAULT_COLORS: Record<Morph.Tool, string> = {
  select: '#000000',
  text: '#000000',
  highlight: HIGHLIGHT,
  shape: PRIMARY,
  stamp: ERROR
}

export { DEFAULT_COLORS, SELECTION_STROKE }
