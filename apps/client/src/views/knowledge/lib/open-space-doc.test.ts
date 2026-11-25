import { beforeEach, describe, expect, it } from 'vitest'

import type { KnowledgeSpace } from '@/apis/knowledge'
import { useSpacesStore } from '@/stores/spaces'
import { findSpaceDocByTitle } from '@/views/knowledge/lib/open-space-doc.ts'

const space = {
  id: 'space-1',
  name: '演示空间',
  rootPath: 'D:\\wiki',
  description: null,
  templateId: 'general',
  autoUpdate: false,
  autoExport: false,
  createdAt: 0,
  updatedAt: 0
} as unknown as KnowledgeSpace

function resetStore(): void {
  useSpacesStore.setState({
    spaces: [space],
    activeSpaceID: space.id,
    docs: [
      {
        id: 'doc-1',
        spaceId: space.id,
        title: '示例页',
        relPath: 'wiki/note/示例页.md',
        wordCount: 10,
        revision: 1,
        status: 'active',
        source: 'manual',
        updatedAt: 0
      }
    ],
    hits: [],
    staging: [],
    query: '',
    isLoading: false,
    isPublishing: false,
    error: null
  })
}

describe('findSpaceDocByTitle', function () {
  beforeEach(resetStore)

  it('matches a page by its title', function () {
    expect(findSpaceDocByTitle('示例页')).toEqual({
      rootPath: 'D:\\wiki',
      relPath: 'wiki/note/示例页.md'
    })
  })

  it('ignores the anchor and the .md suffix', function () {
    expect(findSpaceDocByTitle('示例页#小节')?.relPath).toBe('wiki/note/示例页.md')
    expect(findSpaceDocByTitle('示例页.md')?.relPath).toBe('wiki/note/示例页.md')
  })

  it('returns null for an unknown page', function () {
    expect(findSpaceDocByTitle('不认识')).toBeNull()
  })

  it('returns null when there is no active space', function () {
    useSpacesStore.setState({ activeSpaceID: null })
    expect(findSpaceDocByTitle('示例页')).toBeNull()
  })
})
