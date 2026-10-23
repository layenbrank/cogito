import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@cogito/design/components/alert-dialog'

import { NAMED_LIMIT } from './import.ts'

interface ConflictsDialogProps {
  /** 撞上同名的指令名；null = 不问（没冲突或已经处理完） */
  conflicts: readonly string[] | null
  onCancel: () => void
  /** 同名跳过，只落新的 */
  onSkip: () => void
  /** 同名覆盖 */
  onOverwrite: () => void
}

/**
 * 一批 YAML 里撞上同名指令时的确认。
 *
 * 三个出口对应 corex `import_directives` 的语义：取消整批不做、跳过同名、覆盖同名。
 * 一份批选本来就该问一次 —— 逐个文件弹框比单文件导入还烦。
 */
function ConflictsDialog(props: ConflictsDialogProps) {
  const names = props.conflicts ?? []
  const shown = names.slice(0, NAMED_LIMIT)
  const rest = names.length - shown.length

  return (
    <AlertDialog
      open={props.conflicts !== null}
      onOpenChange={function (isOpen) {
        if (!isOpen) props.onCancel()
      }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {names.length === 1
              ? `「${names[0]}」已存在，如何处理？`
              : `${names.length} 个同名指令已存在，如何处理？`}
          </AlertDialogTitle>
          <AlertDialogDescription
            render={<div className="space-y-2 text-sm text-muted-foreground" />}>
            <p>覆盖会改写指令库里的同名条目；跳过则只导入新的。</p>
            {names.length > 1 ? (
              <ul className="max-h-40 list-inside list-disc overflow-y-auto font-mono text-xs">
                {shown.map(function (name) {
                  return <li key={name}>{name}</li>
                })}
                {rest > 0 ? <li>…等共 {names.length} 个</li> : null}
              </ul>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-between">
          <AlertDialogCancel>取消</AlertDialogCancel>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <AlertDialogAction
              variant="outline"
              onClick={props.onSkip}>
              跳过同名
            </AlertDialogAction>
            <AlertDialogAction onClick={props.onOverwrite}>覆盖同名</AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { ConflictsDialog }
