import {
  BEHAVIOR_PICK_FILE,
  BEHAVIOR_PICK_SKILL,
  findTriggerBehavior,
  type SenderChip,
  type TriggerMatch
} from './sender-trigger'
import { findFileIcon } from '@/features/agent/model/file-icon'
import { normalizePath } from '@/features/agent/model/workspace-path'
import type { SearchHit } from '@/lib/workspace-files'
import type { WorkspaceSkill } from '@/lib/workspace-skills'

interface PopupItem {
  key: string
  label: string
  extra?: string
  icon: string
  chip: Omit<SenderChip, 'id'>
}

function formatFileLabel(relative: string, name: string) {
  const parts = normalizePath(relative).split('/').filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  }
  return name
}

function formatFileExtra(relative: string) {
  const normalized = normalizePath(relative)
  const max = 42
  if (normalized.length <= max) return normalized
  return `…${normalized.slice(-(max - 1))}`
}

function isPathExcluded(excluded: Set<string>, path: string, relative?: string) {
  if (excluded.has(normalizePath(path))) return true
  if (relative && excluded.has(normalizePath(relative))) return true
  return false
}

interface BuildPopupItemsInput {
  match: TriggerMatch
  behaviorId: string
  kind: string
  query: string
  hasRoots: boolean
  fileHits: SearchHit[]
  skills: WorkspaceSkill[]
  isListLoading: boolean
  excludedSet: Set<string>
}

function buildFileItems(input: BuildPopupItemsInput): PopupItem[] {
  const { match, kind, query, hasRoots, fileHits, isListLoading, excludedSet } = input
  const behavior = findTriggerBehavior(match.behaviorId)
  const prefix = behavior?.serializePrefix ?? match.char

  if (!hasRoots) {
    return [
      {
        key: '__empty__',
        label: '请先配置工作区文件夹',
        icon: 'mdi:folder-alert-outline',
        chip: { kind: 'file', label: '', value: '', meta: {} }
      }
    ]
  }
  if (fileHits.length === 0) {
    return [
      {
        key: '__none__',
        label: isListLoading ? '搜索中…' : query ? '无匹配文件' : '输入关键字搜索文件',
        icon: 'mdi:file-search-outline',
        chip: { kind: 'file', label: '', value: '', meta: {} }
      }
    ]
  }
  const available = fileHits.filter(function (hit) {
    return !isPathExcluded(excludedSet, hit.path, hit.relative)
  })
  if (available.length === 0) {
    return [
      {
        key: '__none__',
        label: '所选文件均已引用',
        icon: 'mdi:file-check-outline',
        chip: { kind: 'file', label: '', value: '', meta: {} }
      }
    ]
  }
  return available.map(function (hit) {
    const relative = normalizePath(hit.relative)
    return {
      key: normalizePath(hit.path),
      label: formatFileLabel(relative, hit.name),
      extra: formatFileExtra(relative),
      icon: findFileIcon(hit.name),
      chip: {
        kind: kind || 'file',
        label: hit.name,
        value: `${prefix}${relative}`,
        meta: { name: hit.name, relative, path: normalizePath(hit.path) }
      }
    }
  })
}

function buildSkillItems(input: BuildPopupItemsInput): PopupItem[] {
  const { match, kind, query, hasRoots, skills, isListLoading, excludedSet } = input
  const behavior = findTriggerBehavior(match.behaviorId)
  const prefix = behavior?.serializePrefix ?? match.char

  if (!hasRoots) {
    return [
      {
        key: '__empty__',
        label: '请先配置工作区文件夹',
        icon: 'mdi:folder-alert-outline',
        chip: { kind: 'skill', label: '', value: '', meta: {} }
      }
    ]
  }
  const filtered = skills.filter(function (skill) {
    if (isPathExcluded(excludedSet, skill.path, skill.relative)) return false
    if (!query) return true
    const q = query.toLowerCase()
    return (
      skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q)
    )
  })
  if (filtered.length === 0) {
    return [
      {
        key: '__none__',
        label: isListLoading
          ? '加载中…'
          : skills.length > 0 && !query
            ? '所选技能均已引用'
            : query
              ? '无匹配技能'
              : '暂无技能',
        icon: 'mdi:hammer-wrench',
        chip: { kind: 'skill', label: '', value: '', meta: {} }
      }
    ]
  }
  return filtered.map(function (skill) {
    return {
      key: skill.id,
      label: skill.name,
      extra: skill.description,
      icon: 'mdi:hammer-wrench',
      chip: {
        kind: kind || 'skill',
        label: skill.name,
        value: `${prefix}${skill.name}`,
        meta: {
          name: skill.name,
          relative: normalizePath(skill.relative),
          path: normalizePath(skill.path),
          description: skill.description
        }
      }
    }
  })
}

function buildPopupItems(input: BuildPopupItemsInput): PopupItem[] {
  if (input.behaviorId === BEHAVIOR_PICK_FILE) return buildFileItems(input)
  if (input.behaviorId === BEHAVIOR_PICK_SKILL) return buildSkillItems(input)
  return []
}

export { buildPopupItems }
export type { PopupItem }
