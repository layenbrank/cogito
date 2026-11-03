/**
 * PDF 管道：sidecar-md / 内置 extract（轻量占位） / MinerU HTTP。
 * extractImages 会传给 Rust；有图片路径时供 ingest caption。
 */
import { invoke } from '@tauri-apps/api/core'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'

import { CHANNELS } from '@/shared/ipc/channels.ts'
import { joinPath } from '@/views/knowledge/lib/path.ts'
import { readPdfPipelineConfig } from '@/views/knowledge/lib/pdf-pipeline-config.ts'

interface PdfExtractResult {
  markdown: string
  pageCount: number
  imagePaths?: string[]
}

interface PdfPipelineOutput {
  markdown: string
  imagePaths: string[]
}

async function findSidecarMarkdown(pdfAbsolute: string): Promise<string | null> {
  const candidates = [pdfAbsolute.replace(/\.pdf$/i, '.md'), `${pdfAbsolute}.md`]
  for (const candidate of candidates) {
    try {
      if (await exists(candidate)) return readTextFile(candidate)
    } catch (error) {
      console.warn('[pdf-pipeline] sidecar read failed', candidate, error)
    }
  }
  return null
}

async function extractWithMineru(
  pdfAbsolute: string,
  endpoint: string,
  token: string
): Promise<string> {
  const response = await fetch(endpoint.replace(/\/$/, '') + '/parse', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ path: pdfAbsolute })
  })
  if (!response.ok) throw new Error(`MinerU HTTP ${response.status}`)
  const json = (await response.json()) as { markdown?: string; content?: string }
  const markdown = json.markdown || json.content
  if (!markdown?.trim()) throw new Error('MinerU 返回空正文')
  return markdown
}

async function extractViaBuiltin(input: {
  absolute: string
  rootPath: string
  extractImages: boolean
}): Promise<PdfPipelineOutput> {
  const mediaDir = joinPath(input.rootPath, 'wiki/media')
  const extracted = await invoke<PdfExtractResult>(CHANNELS.KNOWLEDGE.EXTRACT_PDF, {
    path: input.absolute,
    mediaDir,
    extractImages: input.extractImages
  })
  return {
    markdown: extracted.markdown,
    imagePaths: extracted.imagePaths ?? []
  }
}

async function extractPdfMarkdown(input: {
  absolute: string
  rootPath: string
}): Promise<PdfPipelineOutput> {
  const config = readPdfPipelineConfig()
  if (config.backend === 'sidecar-md') {
    const sidecar = await findSidecarMarkdown(input.absolute)
    if (sidecar) {
      const fallback = config.extractImages
        ? await extractViaBuiltin({
            absolute: input.absolute,
            rootPath: input.rootPath,
            extractImages: true
          }).catch(function (error) {
            console.warn('[pdf-pipeline] image collect failed', error)
            return { markdown: sidecar, imagePaths: [] as string[] }
          })
        : { markdown: sidecar, imagePaths: [] as string[] }
      return {
        markdown: sidecar,
        imagePaths: fallback.imagePaths
      }
    }
  }
  if (config.backend === 'mineru' && config.mineruEndpoint.trim()) {
    try {
      const markdown = await extractWithMineru(
        input.absolute,
        config.mineruEndpoint,
        config.mineruToken
      )
      let imagePaths: string[] = []
      if (config.extractImages) {
        try {
          const builtin = await extractViaBuiltin({
            absolute: input.absolute,
            rootPath: input.rootPath,
            extractImages: true
          })
          imagePaths = builtin.imagePaths
        } catch (error) {
          console.warn('[pdf-pipeline] image collect after MinerU failed', error)
        }
      }
      return { markdown, imagePaths }
    } catch (error) {
      console.error('[pdf-pipeline] MinerU failed, fallback extract', error)
    }
  }
  return extractViaBuiltin({
    absolute: input.absolute,
    rootPath: input.rootPath,
    extractImages: config.extractImages
  })
}

export { extractPdfMarkdown, findSidecarMarkdown }
export type { PdfPipelineOutput }
