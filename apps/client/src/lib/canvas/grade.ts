import Konva from 'konva'

/** 调色参数。透明度不在这里，由节点 opacity 负责。 */
interface Grade {
  exposure: number
  contrast: number
  saturation: number
  temperature: number
  blur?: number
  pixelSize?: number
}

interface KonvaGrade {
  filters: Konva.Filter[]
  brightness?: number
  contrast?: number
  saturation?: number
  hue?: number
  blurRadius?: number
  pixelSize?: number
}

const GRADE_EPSILON = 0.001

function isGradeNeutral(grade: Grade): boolean {
  return (
    Math.abs(grade.exposure) < GRADE_EPSILON &&
    Math.abs(grade.contrast) < GRADE_EPSILON &&
    Math.abs(grade.saturation) < GRADE_EPSILON &&
    Math.abs(grade.temperature) < GRADE_EPSILON &&
    (grade.blur ?? 0) < 0.5 &&
    (grade.pixelSize ?? 0) <= 1
  )
}

function formatGradeNumber(value: number): string {
  return String(Math.round(value * 10000) / 10000)
}

/** 静图：Konva.Filters。对比度从 -0.5..0.5 映射到 -50..50。色温用色相角。 */
function toKonvaGrade(grade: Grade): KonvaGrade {
  const filters: Konva.Filter[] = []
  const mapped: KonvaGrade = { filters }
  if (Math.abs(grade.exposure) >= GRADE_EPSILON) {
    filters.push(Konva.Filters.Brighten)
    mapped.brightness = grade.exposure
  }
  if (Math.abs(grade.contrast) >= GRADE_EPSILON) {
    filters.push(Konva.Filters.Contrast)
    mapped.contrast = grade.contrast * 100
  }
  if (
    Math.abs(grade.saturation) >= GRADE_EPSILON ||
    Math.abs(grade.temperature) >= GRADE_EPSILON
  ) {
    filters.push(Konva.Filters.HSL)
    mapped.saturation = grade.saturation
    mapped.hue = grade.temperature * 18
  }
  if ((grade.blur ?? 0) >= 0.5) {
    filters.push(Konva.Filters.Blur)
    mapped.blurRadius = grade.blur
  }
  if ((grade.pixelSize ?? 0) > 1) {
    filters.push(Konva.Filters.Pixelate)
    mapped.pixelSize = grade.pixelSize
  }
  return mapped
}

/** 视频预览：画到离屏 canvas，避免对视频每帧 cache。 */
function toCanvasFilter(grade: Grade): string {
  const parts = [
    `brightness(${formatGradeNumber(1 + grade.exposure)})`,
    `contrast(${formatGradeNumber(1 + grade.contrast)})`,
    `saturate(${formatGradeNumber(1 + grade.saturation)})`,
    `hue-rotate(${formatGradeNumber(grade.temperature * 18)}deg)`
  ]
  if ((grade.blur ?? 0) >= 0.5) parts.push(`blur(${formatGradeNumber(grade.blur ?? 0)}px)`)
  return parts.join(' ')
}

/** 导出滤镜链。中性项省略。 */
function toFfmpegGrade(grade: Grade): string {
  const parts: string[] = []
  const brightness = grade.exposure
  const contrast = 1 + grade.contrast
  const saturation = 1 + grade.saturation
  if (
    Math.abs(brightness) >= GRADE_EPSILON ||
    Math.abs(contrast - 1) >= GRADE_EPSILON ||
    Math.abs(saturation - 1) >= GRADE_EPSILON
  ) {
    parts.push(
      `eq=brightness=${formatGradeNumber(brightness)}:contrast=${formatGradeNumber(contrast)}:saturation=${formatGradeNumber(saturation)}`
    )
  }
  if (Math.abs(grade.temperature) >= GRADE_EPSILON) {
    parts.push(`hue=h=${formatGradeNumber(grade.temperature * 18)}`)
  }
  if ((grade.blur ?? 0) >= 0.5) {
    parts.push(`gblur=sigma=${formatGradeNumber(grade.blur ?? 0)}`)
  }
  if ((grade.pixelSize ?? 0) > 1) {
    const size = Math.max(2, Math.round(grade.pixelSize ?? 2))
    parts.push(`pixelize=w=${size}:h=${size}`)
  }
  return parts.join(',')
}

export type { Grade, KonvaGrade }
export { isGradeNeutral, toKonvaGrade, toCanvasFilter, toFfmpegGrade }
