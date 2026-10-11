/**
 * 新指令的两件事：给一份 corex 认的骨架、起个没被占用的名字。
 *
 * 骨架只写 corex **不给默认值**的字段（`name` 必有、`steps` 可以是空的 `[]`），其余留空让它自己补：
 * 多写一份默认值就有两处真相，改一边忘一边。
 */

import type { DirectiveContent } from '@/shared/ipc/specs/sidecar'

/** 新指令的默认名，被占了就往后编号 */
const NEW_DIRECTIVE_NAME = 'untitled'

function createDirective(name: string): DirectiveContent {
  return { name, description: '', version: '1.0', inputs: [], steps: [] }
}

/** 起个还没被占用的名字：`untitled`、`untitled-2`… */
function findFreeName(taken: readonly string[]): string {
  const used = new Set(taken)
  if (!used.has(NEW_DIRECTIVE_NAME)) return NEW_DIRECTIVE_NAME

  let seq = 2
  while (used.has(`${NEW_DIRECTIVE_NAME}-${seq}`)) seq += 1
  return `${NEW_DIRECTIVE_NAME}-${seq}`
}

export { NEW_DIRECTIVE_NAME, createDirective, findFreeName }
