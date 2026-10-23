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

/** 导入前发现同名时要问的那一问 */
interface OverwritePrompt {
  path: string
  names: readonly string[]
}

interface Props {
  prompt: OverwritePrompt | null
  onCancel: () => void
  /** 同名跳过，只导入新的 */
  onSkip: (path: string) => void
  /** 同名覆盖 */
  onOverwrite: (path: string) => void
}

/** 对话框里最多点名几个；再多就「等共 N 个」，避免一长串把对话框撑爆 */
const NAMED_LIMIT = 8

/**
 * 导入撞上已有同名指令时的确认。
 *
 * 三个出口对应 corex `import_directives` 的语义：取消整批不做、跳过同名、覆盖同名。
 * 只有 dry_run 扫到 `skipped` 才弹 —— 没有冲突时不必多点一次。
 *
 * 跳过 / 覆盖把 `path` 一并交出：对话框一关 `onOpenChange` 会先清掉 prompt，
 * 回调如果再去读 state 会拿到 `null`。
 */
function ImportOverwriteDialog(props: Props) {
  const { prompt } = props
  const names = prompt?.names ?? []
  const shown = names.slice(0, NAMED_LIMIT)
  const rest = names.length - shown.length
  const path = prompt?.path ?? ''

  return (
    <AlertDialog
      open={prompt !== null}
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
              onClick={function () {
                if (path) props.onSkip(path)
              }}>
              跳过同名
            </AlertDialogAction>
            <AlertDialogAction
              onClick={function () {
                if (path) props.onOverwrite(path)
              }}>
              覆盖同名
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { ImportOverwriteDialog }
export type { OverwritePrompt }
