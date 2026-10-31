import { KnowledgeWorkspaceView } from '@/views/knowledge/workspace/knowledge-workspace-view.tsx'
import { useKnowledgeWorkspace } from '@/views/knowledge/workspace/use-knowledge-workspace.ts'

export default function KnowledgeWorkspace() {
  const state = useKnowledgeWorkspace()
  return <KnowledgeWorkspaceView {...state} />
}
