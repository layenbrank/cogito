/**
 * 工具分类的**跨模块对账**：同一个工具名在「安全判定 / 卡片形态 / 文件改动抽取」三处
 * 不能得出互相矛盾的结论。
 *
 * 为什么需要这个测试：这三个判定曾经各写一份启发式，且有两个函数同名（都叫
 * `isWriteTool`）却语义不同 —— 结果是「明明写了文件，却没有写卡 / CodeDiff 消失」，
 * 或者「审批放行了，卡片却把它当只读」。它们**不要求**完全相等（终端卡、浏览器卡是
 * 有意的不同形态），要求的是**单向包含**：
 *
 * 1. 判为「写卡」的，安全判定必须也是 write（否则会出现「画了写卡却自动放行」）；
 * 2. 判为「动文件」的，安全判定必须是 write；
 * 3. 三处判定都必须先剥 server 前缀（`local__cogito_terminal_run` 与本体同结论）。
 */

import { classifyToolEffect, isWriteTool } from '@cogito/agent-protocol/policy'
import { describe, expect, it } from 'vitest'

import { usesWriteCard } from '@/features/agent/tool-labels'
import { isFileMutationTool } from '@/features/agent/tool-paths'

/** 真实会出现的一批工具名：goose 内置 + cogito-mcp + corex-mcp + 第三方 MCP + 带前缀形态 */
const TOOL_NAMES = [
  // goose 内置
  'read',
  'write',
  'edit',
  'text_editor',
  'str_replace',
  'shell',
  'grep',
  'glob',
  'todo_write',
  'subagent',
  'skill',
  // cogito-mcp（可见终端 / 工作区 / 浏览器 / 知识库）
  'cogito_workspace_read',
  'cogito_workspace_list',
  'cogito_workspace_write',
  'cogito_workspace_patch',
  'cogito_terminal_run',
  'cogito_terminal_read',
  'cogito_terminal_write',
  'cogito_terminal_list',
  'cogito_browser_open',
  'cogito_browser_read',
  'cogito_browser_screenshot',
  'cogito_knowledge_search',
  'cogito_knowledge_write_doc',
  'cogito_knowledge_ingest',
  'cogito_knowledge_workspace_write',
  // corex-mcp
  'corex_actions',
  'corex_validate',
  'corex_run',
  'corex_invoke',
  // 第三方 MCP（动词启发式的软肋）
  'push_files',
  'send_message',
  'fetch_url',
  'open_pr'
] as const

describe('工具分类对账', function () {
  it('写卡 ⊆ 安全写：画成写入卡的工具，安全判定不能是只读', function () {
    const violations = TOOL_NAMES.filter(function (name) {
      return usesWriteCard(name) && !isWriteTool(name)
    })
    expect(violations).toEqual([])
  })

  it('文件改动 ⊆ 安全写：会抽文件路径的工具，安全判定不能是只读', function () {
    const violations = TOOL_NAMES.filter(function (name) {
      return isFileMutationTool(name) && !isWriteTool(name)
    })
    expect(violations).toEqual([])
  })

  it('带 server 前缀与本体同结论', function () {
    for (const name of TOOL_NAMES) {
      expect(classifyToolEffect(`local__${name}`)).toBe(classifyToolEffect(name))
      expect(classifyToolEffect(`mcp__local__${name}`)).toBe(classifyToolEffect(name))
      expect(usesWriteCard(`local__${name}`)).toBe(usesWriteCard(name))
      expect(isFileMutationTool(`local__${name}`)).toBe(isFileMutationTool(name))
    }
  })

  it('三处**有意**不同的几类，结论固定下来（改动必须是有意识的）', function () {
    // 安全判定为写，但卡片另有形态：右栏终端卡 / 浏览器卡
    expect(isWriteTool('cogito_terminal_run')).toBe(true)
    expect(usesWriteCard('cogito_terminal_run')).toBe(false)
    expect(isWriteTool('cogito_browser_open')).toBe(true)
    expect(usesWriteCard('cogito_browser_open')).toBe(false)

    // 名字里带 write 但只是查看：只读
    expect(isWriteTool('cogito_terminal_read')).toBe(false)

    // 动词启发式认不出的第三方工具：fail-closed 按写处理
    expect(isWriteTool('push_files')).toBe(true)
    expect(isWriteTool('open_pr')).toBe(true)
    expect(isWriteTool('fetch_url')).toBe(true)
    // 已知只读的联网工具走精确名单，不被上述收紧误拦
    expect(classifyToolEffect('webfetch')).toBe('read')

    // 文件写：三处一致认为是「动文件」
    for (const name of ['cogito_workspace_write', 'cogito_workspace_patch', 'text_editor']) {
      expect(isWriteTool(name)).toBe(true)
      expect(usesWriteCard(name)).toBe(true)
      expect(isFileMutationTool(name)).toBe(true)
    }
  })
})
