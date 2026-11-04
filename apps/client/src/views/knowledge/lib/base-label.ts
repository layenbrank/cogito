/**
 * 知识库下拉展示名：永不回退成裸 id（Base UI Select.Value 默认渲染 value）。
 */
import type { KnowledgeBase } from '@/shared/ipc/specs/knowledge'

function findKnowledgeBaseLabel(
  base: Pick<KnowledgeBase, 'id' | 'name' | 'slug'> | null | undefined
): string {
  if (!base) return '未知知识库'
  const name = base.name?.trim()
  if (name) return name
  const slug = base.slug?.trim()
  if (slug) return slug
  return '未命名知识库'
}

export { findKnowledgeBaseLabel }
