type HandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const MIN_SEL = 20

function clampSelectionRect(input: {
  type: HandleType
  px: number
  py: number
  dragStart: { sx: number; sy: number; sw: number; sh: number }
  width: number
  height: number
}): { x: number; y: number; w: number; h: number } {
  const { type, px, py, width, height } = input
  const { sx, sy, sw, sh } = input.dragStart
  const right = sx + sw
  const bottom = sy + sh
  let nx = sx
  let ny = sy
  let nw = sw
  let nh = sh

  switch (type) {
    case 'nw':
      nx = Math.max(0, Math.min(px, right - MIN_SEL))
      ny = Math.max(0, Math.min(py, bottom - MIN_SEL))
      nw = right - nx
      nh = bottom - ny
      break
    case 'n':
      ny = Math.max(0, Math.min(py, bottom - MIN_SEL))
      nh = bottom - ny
      break
    case 'ne':
      ny = Math.max(0, Math.min(py, bottom - MIN_SEL))
      nw = Math.max(MIN_SEL, Math.min(px - sx, width - sx))
      nh = bottom - ny
      break
    case 'e':
      nw = Math.max(MIN_SEL, Math.min(px - sx, width - sx))
      break
    case 'se':
      nw = Math.max(MIN_SEL, Math.min(px - sx, width - sx))
      nh = Math.max(MIN_SEL, Math.min(py - sy, height - sy))
      break
    case 's':
      nh = Math.max(MIN_SEL, Math.min(py - sy, height - sy))
      break
    case 'sw':
      nx = Math.max(0, Math.min(px, right - MIN_SEL))
      nw = right - nx
      nh = Math.max(MIN_SEL, Math.min(py - sy, height - sy))
      break
    case 'w':
      nx = Math.max(0, Math.min(px, right - MIN_SEL))
      nw = right - nx
      break
  }

  return { x: nx, y: ny, w: nw, h: nh }
}

export type { HandleType }
export { MIN_SEL, clampSelectionRect }
