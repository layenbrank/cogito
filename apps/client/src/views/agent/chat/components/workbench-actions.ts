import dayjs from 'dayjs'
import { toast } from 'sonner'

import { findWorkspaceRoots } from './workbench-submit'
import { applyDiff, parseParts, stringifyParts } from '@/features/agent/model/tools'
import { useCalendarStore } from '@/stores/calendar'
import { useAgentStore } from '@/stores/agent'

async function applyDiffPart(messageID: string, partIndex: number) {
  const target = useAgentStore.getState().messages.find(function (item) {
    return item.id === messageID
  })
  if (!target) return
  const parts = parseParts(target.parts)
  const part = parts[partIndex]
  if (!part || part.type !== 'diff' || part.data.applied) return
  const roots = findWorkspaceRoots()
  try {
    await applyDiff(part, roots)
    parts[partIndex] = { type: 'diff', data: { ...part.data, applied: true } }
    await useAgentStore
      .getState()
      .toUpdateMessage([{ id: messageID, parts: stringifyParts(parts), updatedAt: Date.now() }])
    toast.success('修改已写入文件（原文件已备份）')
  } catch (error) {
    console.error('[workbench] applyDiff failed', error)
    toast.error('写入失败：' + (error instanceof Error ? error.message : String(error)))
  }
}

async function togglePlanItem(messageID: string, partIndex: number, itemIndex: number) {
  const target = useAgentStore.getState().messages.find(function (item) {
    return item.id === messageID
  })
  if (!target) return
  const parts = parseParts(target.parts)
  const part = parts[partIndex]
  if (!part || part.type !== 'plan') return
  const items = part.data.items.map(function (item, index) {
    return index === itemIndex ? { ...item, done: !item.done } : item
  })
  parts[partIndex] = { type: 'plan', data: { ...part.data, items } }
  await useAgentStore.getState().toUpdateMessage([{ id: messageID, parts: stringifyParts(parts) }])
}

async function writePlanToCalendar(messageID: string, partIndex: number) {
  const target = useAgentStore.getState().messages.find(function (item) {
    return item.id === messageID
  })
  if (!target) return
  const parts = parseParts(target.parts)
  const part = parts[partIndex]
  if (!part || part.type !== 'plan') return

  const base = dayjs(part.data.date || undefined).startOf('day')
  let written = 0
  for (const item of part.data.items) {
    let start = base
    if (item.time) {
      const [hour, minute] = item.time.split(':').map(Number)
      start = base.hour(hour || 0).minute(minute || 0)
    }
    const end = item.time ? start.add(30, 'minute') : base.endOf('day')
    const id = await useCalendarStore.getState().toWriteEvent({
      title: item.title,
      notes: '由 Agent 计划生成',
      startAt: start.valueOf(),
      endAt: end.valueOf(),
      entireDay: !item.time
    })
    if (id) written += 1
  }
  if (written) {
    toast.success(`已写入 ${written} 条日程到日历`)
  } else {
    toast.error('写入日历失败')
  }
}

async function copyMessage(messageID: string) {
  const target = useAgentStore.getState().messages.find(function (item) {
    return item.id === messageID
  })
  if (!target) return
  try {
    await navigator.clipboard.writeText(target.fragment)
    toast.success('已复制到剪贴板')
  } catch (error) {
    console.error('[workbench] copy message failed', error)
    toast.error('复制失败')
  }
}

export { applyDiffPart, copyMessage, togglePlanItem, writePlanToCalendar }
