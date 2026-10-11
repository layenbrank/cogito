import type { Editor as Composer } from '@tiptap/react'
import { useEditorState as useComposerValue } from '@tiptap/react'
import { clsx } from 'clsx'

import { ComposerToolbarActions } from './composer-toolbar-actions.tsx'
import { findComposerToolbarState } from './composer-toolbar-state.ts'
import styles from '@/views/markdown/composer-context.module.scss'

export default function ComposerContext({ composer }: { composer: Composer }) {
  const composerValue = useComposerValue({
    editor: composer,
    selector(ctx) {
      return findComposerToolbarState(ctx.editor)
    }
  })

  return (
    <div className={clsx([styles.composer, styles.context, 'control-group'])}>
      <ComposerToolbarActions
        composer={composer}
        state={composerValue}
      />
    </div>
  )
}
