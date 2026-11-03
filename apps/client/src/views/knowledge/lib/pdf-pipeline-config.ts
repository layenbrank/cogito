/**
 * PDF 解析管线配置（对齐 llm_wiki MinerU / pdfium）。
 */
const STORAGE_KEY = 'knowledge.pdf-pipeline.config'

type PdfBackend = 'pdfium' | 'sidecar-md' | 'mineru'

interface PdfPipelineConfig {
  backend: PdfBackend
  mineruEndpoint: string
  mineruToken: string
  extractImages: boolean
}

const PDF_PIPELINE_DEFAULTS: PdfPipelineConfig = {
  backend: 'sidecar-md',
  mineruEndpoint: '',
  mineruToken: '',
  extractImages: false
}

function readPdfPipelineConfig(): PdfPipelineConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...PDF_PIPELINE_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<PdfPipelineConfig>
    return { ...PDF_PIPELINE_DEFAULTS, ...parsed }
  } catch (error) {
    console.warn('[pdf-pipeline-config] read failed', error)
    return { ...PDF_PIPELINE_DEFAULTS }
  }
}

function writePdfPipelineConfig(config: PdfPipelineConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (error) {
    console.warn('[pdf-pipeline-config] write failed', error)
  }
}

function patchPdfPipelineConfig(patch: Partial<PdfPipelineConfig>): PdfPipelineConfig {
  const next = { ...readPdfPipelineConfig(), ...patch }
  writePdfPipelineConfig(next)
  return next
}

export {
  PDF_PIPELINE_DEFAULTS,
  patchPdfPipelineConfig,
  readPdfPipelineConfig,
  writePdfPipelineConfig
}
export type { PdfBackend, PdfPipelineConfig }
