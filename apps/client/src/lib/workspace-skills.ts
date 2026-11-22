/**
 * 工作区技能 IPC：扫描 SKILL.md frontmatter
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

interface WorkspaceSkill {
  id: string
  name: string
  description: string
  path: string
  relative: string
}

async function GET_WORKSPACE_SKILLS(roots: string[]) {
  return invoke<WorkspaceSkill[]>(CHANNELS.WORKSPACE_SKILLS.LIST, {
    params: { roots }
  })
}

const WorkspaceSkills = {
  GET_WORKSPACE_SKILLS
}

export { WorkspaceSkills }
export type { WorkspaceSkill }
