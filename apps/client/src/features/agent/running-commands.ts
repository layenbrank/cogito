/**
 * 正在执行的命令（右栏「详情」用）。
 *
 * 数据只从会话里的 tool-call part 派生：`status.type === 'running'` 且参数里能读出命令，
 * 就是「此刻在跑什么」。不额外存一次状态，避免与 assistant-ui 的会话状态两处打架。
 *
 * 耗时由本模块自己记「第一次看到它跑起来」的时间：tool-call part 不带开始时间戳，
 * 用消息创建时间会被同一条消息里的多个工具调用互相污染。
 */
import { useAuiState, type ThreadMessage, type ToolCallMessagePart } from '@assistant-ui/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { toShellCommand } from '@/views/agent/chat/components/tool-output'

interface RunningCommand {
  toolCallId: string
  command: string
  workdir: string | null
  background: boolean
}

interface RunningCommandState extends RunningCommand {
  /** 已运行毫秒数（首次观察到起算） */
  elapsedMs: number
}

/**
 * 会话消息里没有 `status`（那是渲染器 props 才有的字段），只能从结果推断：
 * 还没结果、或者结果只是流式中间态，就是「正在跑」。等审批 / 等人工回答不算执行中。
 */
function isRunningToolPart(part: ToolCallMessagePart): boolean {
  if (part.isPreliminary) return true
  if (part.result !== undefined) return false
  if (part.interrupt) return false
  if (part.approval && part.approval.approved === undefined) return false
  return true
}

function findRunningCommands(messages: readonly ThreadMessage[]): RunningCommand[] {
  const commands: RunningCommand[] = []
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== 'tool-call') continue
      if (!isRunningToolPart(part)) continue
      const shell = toShellCommand(part.args)
      if (!shell) continue
      commands.push({
        toolCallId: part.toolCallId,
        command: shell.command,
        workdir: shell.workdir,
        background: shell.background
      })
    }
  }
  return commands
}

/** 运行中的命令 + 每秒刷新的耗时；没有命令时不挂定时器 */
function useRunningCommands(): RunningCommandState[] {
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  const commands = useMemo(
    function () {
      return findRunningCommands(messages)
    },
    [messages]
  )
  const startedAt = useRef(new Map<string, number>())
  const [now, updateNow] = useState(function () {
    return Date.now()
  })

  useEffect(
    function () {
      const active = new Set(
        commands.map(function (command) {
          return command.toolCallId
        })
      )
      const seen = startedAt.current
      for (const id of active) {
        if (!seen.has(id)) seen.set(id, Date.now())
      }
      for (const id of seen.keys()) {
        if (!active.has(id)) seen.delete(id)
      }
    },
    [commands]
  )

  useEffect(
    function () {
      if (commands.length === 0) return
      const timer = window.setInterval(function () {
        updateNow(Date.now())
      }, 1000)
      return function () {
        window.clearInterval(timer)
      }
    },
    [commands.length]
  )

  return commands.map(function (command) {
    const started = startedAt.current.get(command.toolCallId) ?? now
    return { ...command, elapsedMs: Math.max(0, now - started) }
  })
}

export { findRunningCommands, isRunningToolPart, useRunningCommands }
export type { RunningCommand, RunningCommandState }
