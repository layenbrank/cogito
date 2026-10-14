interface FrontMatterSlice {
  frontMatter: string | null
  body: string
}

const FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function parseFrontMatter(source: string): FrontMatterSlice {
  const matched = FRONT_MATTER_PATTERN.exec(source)
  if (!matched) {
    return { frontMatter: null, body: source }
  }
  return {
    frontMatter: matched[1] ?? '',
    body: source.slice(matched[0].length)
  }
}

function joinFrontMatter(frontMatter: string | null, body: string): string {
  if (frontMatter === null || frontMatter === '') return body
  const trimmedBody = body.replace(/^\r?\n/, '')
  return `---\n${frontMatter}\n---\n\n${trimmedBody}`
}

export type { FrontMatterSlice }
export { parseFrontMatter, joinFrontMatter }
