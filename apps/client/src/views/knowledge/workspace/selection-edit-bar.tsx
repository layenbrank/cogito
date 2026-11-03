/**
 * 划词 Ask / Edit 浮动条。
 */
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import type { Editor } from '@tiptap/react'
import { useState } from 'react'
import { toast } from 'sonner'

import { runSelectionEdit } from '@/views/knowledge/lib/selection-edit.ts'

interface SelectionEditBarProps {
  editor: Editor | null
}

function SelectionEditBar(props: SelectionEditBarProps) {
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)

  async function run(mode: 'ask' | 'edit') {
    const editor = props.editor
    if (!editor) return
    const { from, to } = editor.state.selection
    const selection = editor.state.doc.textBetween(from, to, '\n')
    if (!selection.trim()) {
      toast.message('请先选中一段文本')
      return
    }
    setBusy(true)
    setAnswer(null)
    try {
      const result = await runSelectionEdit({
        mode,
        selection,
        instruction,
        documentContext: editor.getText().slice(0, 3_000)
      })
      if (mode === 'edit') {
        editor.chain().focus().insertContentAt({ from, to }, result).run()
        toast.success('已替换选区')
      } else {
        setAnswer(result)
      }
    } catch (error) {
      console.error('[selection-edit] failed', error)
      toast.error(error instanceof Error ? error.message : '划词操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-border bg-background/90 flex flex-col gap-1 border-b px-2 py-1">
      <div className="flex items-center gap-1">
        <Input
          className="h-7 flex-1 text-xs"
          placeholder="划词指令（Ask / Edit）"
          value={instruction}
          onChange={function (event) {
            setInstruction(event.target.value)
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px]"
          disabled={busy}
          onClick={function () {
            void run('ask')
          }}>
          Ask
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 text-[11px]"
          disabled={busy}
          onClick={function () {
            void run('edit')
          }}>
          Edit
        </Button>
      </div>
      {answer ? (
        <p className="text-muted-foreground max-h-20 overflow-y-auto overscroll-y-contain text-[11px]">
          {answer}
        </p>
      ) : null}
    </div>
  )
}

export { SelectionEditBar }
