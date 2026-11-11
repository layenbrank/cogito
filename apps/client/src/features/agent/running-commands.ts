/**
 * 会话内 shell 命令（右栏「详情」用）。
 *
 * 数据从 tool-call part 派生：参数里能读出命令就收录。**完成/失败也保留**，
 * 避免多命令连跑时整块挂卸导致右栏抖动。
 *
 * 耗时由本模块记「第一次看到它」的时间；结束后冻结，不再跟着 now 跳。
 */
import { useAuiState, type ThreadMessage, type ToolCallMessagePart } from '@assistant-ui/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { toShellCommand } from '@/views/agent/chat/components/tool-output'

/**
 * `interrupted`：历史里那种「有 tool-call、永远没有结果」的条目。
 *
 * 应用重启 / 回合被强杀后，工具结果不会补写进历史；如果还按「无结果 = 运行中」渲染，
 * 右栏会永远挂着一个正在跑的命令 —— 用户既看不到它，也关不掉。
 */
type CommandStatus = 'running' | 'done' | 'error' | 'waiting' | 'interrupted'

/** `panel` = app_terminal_*（右栏可见）；`external` = goose shell 等黑盒 */
type CommandSource = 'panel' | 'external'

function findCommandSource(toolName: string): CommandSource {
  const lower = toolName.toLowerCase()
  if (lower.includes('app_terminal')) return 'panel'
  return 'external'
}

interface SessionCommand {
  toolCallId: string
  command: string
  workdir: string | null
  background: boolean
  status: CommandStatus
  source: CommandSource
}

interface SessionCommandState extends SessionCommand {
  /** 已运行 / 总耗时毫秒（结束后冻结） */
  elapsedMs: number
}

/**
 * 会话消息里没有 `status`（那是渲染器 props 才有的字段），只能从结果推断：
 * 还没结果、或者结果只是流式中间态，就是「正在跑」。等审批 / 等人工回答不算执行中。
 */
function isRunningToolPart(part: ToolCallMessagePart, isThreadRunning = true): boolean {
  if (part.isPreliminary) return true
  if (part.result !== undefined) return false
  if (part.interrupt) return false
  if (part.approval && part.approval.approved === undefined) return false
  // 线程已经不在跑：这条工具调用不可能还在执行，只可能是「结果没落库」
  return isThreadRunning
}

function findCommandStatus(part: ToolCallMessagePart, isThreadRunning = true): CommandStatus {
  if (part.approval && part.approval.approved === undefined) return 'waiting'
  if (part.interrupt) return 'waiting'
  if (part.result !== undefined) return part.isError === true ? 'error' : 'done'
  if (part.isError === true) return 'error'
  return isRunningToolPart(part, isThreadRunning) ? 'running' : 'interrupted'
}

/** 仅仍在跑的 shell 命令（兼容旧调用） */
function findRunningCommands(messages: readonly ThreadMessage[]): SessionCommand[] {
  // 兼容旧调用：没有线程态可读时按「可能在跑」处理（只在当前运行的会话里用）
  return findSessionCommands(messages).filter(function (command) {
    return command.status === 'running'
  })
}

/**
 * 本会话全部 shell 命令（含完成/失败/等待），按出现顺序。
 * 右栏长显用这份，避免完成即从列表消失。
 */
function findSessionCommands(
  messages: readonly ThreadMessage[],
  isThreadRunning = true
): SessionCommand[] {
  const commands: SessionCommand[] = []
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== 'tool-call') continue
      const shell = toShellCommand(part.args)
      if (!shell) continue
      commands.push({
        toolCallId: part.toolCallId,
        command: shell.command,
        workdir: shell.workdir,
        background: shell.background,
        status: findCommandStatus(part, isThreadRunning),
        source: findCommandSource(part.toolName)
      })
    }
  }
  return commands
}

/** 右栏展示条数上限：够看近期连跑，又不把详情撑爆 */
const SESSION_COMMAND_CAP = 24

/**
 * 会话命令 + 每秒刷新的耗时（仅 running 时挂定时器）。
 * 完成后 elapsed 冻结在 finishedAt。
 */
function useSessionCommands(): SessionCommandState[] {
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  /** 线程是否在跑：决定「没有结果」到底是执行中还是历史残渣 */
  const isThreadRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  const commands = useMemo(
    function () {
      return findSessionCommands(messages, isThreadRunning)
    },
    [messages, isThreadRunning]
  )
  const startedAt = useRef(new Map<string, number>())
  const finishedAt = useRef(new Map<string, number>())
  const [now, updateNow] = useState(function () {
    return Date.now()
  })

  const hasRunning = commands.some(function (command) {
    return command.status === 'running'
  })

  useEffect(
    function () {
      const seen = startedAt.current
      const done = finishedAt.current
      const active = new Set(
        commands.map(function (command) {
          return command.toolCallId
        })
      )

      for (const command of commands) {
        if (!seen.has(command.toolCallId)) {
          seen.set(command.toolCallId, Date.now())
        }
        if (command.status === 'running') {
          done.delete(command.toolCallId)
        } else if (!done.has(command.toolCallId)) {
          done.set(command.toolCallId, Date.now())
        }
      }

      for (const id of seen.keys()) {
        if (!active.has(id)) {
          seen.delete(id)
          done.delete(id)
        }
      }
    },
    [commands]
  )

  useEffect(
    function () {
      if (!hasRunning) return
      const timer = window.setInterval(function () {
        updateNow(Date.now())
      }, 1000)
      return function () {
        window.clearInterval(timer)
      }
    },
    [hasRunning]
  )

  const capped =
    commands.length > SESSION_COMMAND_CAP
      ? commands.slice(commands.length - SESSION_COMMAND_CAP)
      : commands

  return capped.map(function (command) {
    const started = startedAt.current.get(command.toolCallId) ?? now
    const ended =
      command.status === 'running'
        ? now
        : (finishedAt.current.get(command.toolCallId) ?? now)
    return { ...command, elapsedMs: Math.max(0, ended - started) }
  })
}

export {
  findCommandSource,
  findRunningCommands,
  findSessionCommands,
  isRunningToolPart,
  useSessionCommands
}
export type { CommandSource, CommandStatus, SessionCommand, SessionCommandState }
