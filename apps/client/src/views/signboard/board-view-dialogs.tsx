import { toast } from 'sonner'

import { AutomationSheet } from '@/views/signboard/automation-sheet'
import { CardSheet } from '@/views/signboard/card-sheet'
import { NameDialog } from '@/views/signboard/name-dialog'
import type { useBoardView } from '@/views/signboard/use-board-view.ts'

type BoardViewState = ReturnType<typeof useBoardView>

function BoardViewDialogs(props: BoardViewState) {
  return (
    <>
      <CardSheet
        key={props.activeCard?.id ?? 'closed'}
        card={props.activeCard ?? null}
        open={props.sheetOpen}
        onUpdateOpen={props.setSheetOpen}
      />

      <AutomationSheet
        open={props.automationOpen}
        onUpdateOpen={props.setAutomationOpen}
        boardID={props.activeBoardID}
        columns={props.orderedColumns}
        tags={props.tags}
      />

      <NameDialog
        key={props.nameDialog?.kind === 'board-create' ? 'board-create' : 'board-create-idle'}
        open={props.nameDialog?.kind === 'board-create'}
        title="新建看板"
        description="用于区分工作流主题，例如个人、副业或项目代号。"
        placeholder="例如：本周交付"
        confirmLabel="创建"
        onClose={function () {
          props.setNameDialog(null)
        }}
        onConfirm={async function (title) {
          const id = await props.toWriteBoard(title)
          if (!id) {
            toast.error('创建看板失败')
            throw new Error('create board failed')
          }
          toast.success('已创建看板')
        }}
      />

      <NameDialog
        key={
          props.nameDialog?.kind === 'board-rename'
            ? `board-rename-${props.nameDialog.boardID}`
            : 'board-rename-idle'
        }
        open={props.nameDialog?.kind === 'board-rename'}
        title="重命名看板"
        initialValue={props.nameDialog?.kind === 'board-rename' ? props.nameDialog.title : ''}
        confirmLabel="保存"
        onClose={function () {
          props.setNameDialog(null)
        }}
        onConfirm={async function (title) {
          if (props.nameDialog?.kind !== 'board-rename') return
          const ok = await props.toUpdateBoard(props.nameDialog.boardID, { title })
          if (!ok) {
            toast.error('重命名失败')
            throw new Error('rename board failed')
          }
          toast.success('已重命名')
        }}
      />

      <NameDialog
        key={
          props.nameDialog?.kind === 'column-rename'
            ? `column-rename-${props.nameDialog.column.id}`
            : 'column-rename-idle'
        }
        open={props.nameDialog?.kind === 'column-rename'}
        title="重命名列"
        initialValue={props.nameDialog?.kind === 'column-rename' ? props.nameDialog.column.title : ''}
        confirmLabel="保存"
        onClose={function () {
          props.setNameDialog(null)
        }}
        onConfirm={async function (title) {
          if (props.nameDialog?.kind !== 'column-rename') return
          const ok = await props.toUpdateColumn(props.nameDialog.column.id, { title })
          if (!ok) {
            toast.error('重命名失败')
            throw new Error('rename column failed')
          }
          toast.success('已重命名列')
        }}
      />
    </>
  )
}

export { BoardViewDialogs }
