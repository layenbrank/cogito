/**
 * 知识库下拉展示名：永不回退成裸 id（Space UI Select.Value 默认渲染 value）。
 */
import type { KnowledgeSpace } from '@/shared/ipc/specs/knowledge'

function findKnowledgeSpaceLabel(
  space: Pick<KnowledgeSpace, 'id' | 'name' | 'slug'> | null | undefined
): string {
  if (!space) return '未知空间'
  const name = space.name?.trim()
  if (name) return name
  const slug = space.slug?.trim()
  if (slug) return slug
  return '未命名空间'
}

export { findKnowledgeSpaceLabel }
