import { Sheet, SheetContent, SheetTitle } from '@cogito/design/components/sheet'
import { toast } from 'sonner'

import type { SignboardColumn, SignboardTag } from '@/stores/signboard'
import { AutomationRuleForm } from '@/views/signboard/automation-rule-form.tsx'
import { AutomationRuleList } from '@/views/signboard/automation-rule-list.tsx'
import { useAutomationSheet } from '@/views/signboard/use-automation-sheet.ts'
import styles from '@/views/signboard/signboard.module.scss'

interface AutomationSheetProps {
  open: boolean
  onUpdateOpen: (open: boolean) => void
  boardID: string | null
  columns: SignboardColumn[]
  tags: SignboardTag[]
}

function AutomationSheet(props: AutomationSheetProps) {
  const sheet = useAutomationSheet(props.boardID)

  return (
    <Sheet
      open={props.open}
      onOpenChange={props.onUpdateOpen}>
      <SheetContent
        side="right"
        showCloseButton
        overlayClassName="bg-black/20 supports-backdrop-filter:backdrop-blur-xs"
        className="w-[min(420px,94vw)] gap-0 overflow-y-auto sm:max-w-none">
        <SheetTitle className="mb-4 text-lg">自动化规则</SheetTitle>

        <div className={styles.sheetSection}>
          <AutomationRuleList
            rules={sheet.ordered}
            columns={props.columns}
            tags={props.tags}
            onToggleEnabled={function (ruleID, enabled) {
              void sheet.toUpdateAutomation(ruleID, { enabled })
            }}
            onEdit={sheet.fillRule}
            onRemove={function (ruleID) {
              void sheet.toRemoveAutomation(ruleID).then(function (ok) {
                if (!ok) toast.error('删除失败')
                else toast.success('已删除')
              })
            }}
          />

          <AutomationRuleForm
            draft={sheet.draft}
            editingID={sheet.editingID}
            columns={props.columns}
            tags={props.tags}
            onDraftChange={function (updater) {
              sheet.setDraft(updater)
            }}
            onSave={function () {
              void sheet.saveRule()
            }}
            onReset={sheet.resetForm}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { AutomationSheet }
