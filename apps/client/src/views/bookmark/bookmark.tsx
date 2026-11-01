import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useShellSurface } from '@/features/window-shell/slots'
import { useMirrorStore } from '@/stores/mirror'
import styles from '@/views/bookmark/bookmark.module.scss'
import { BookmarkImportDialog } from '@/views/bookmark/import-dialog'
import { BookmarkLibrary } from '@/views/bookmark/library'

function wantsImportOpen(params: URLSearchParams) {
  if (params.get('import') === '1') return true
  if (params.get('tab') === 'import') return true
  return false
}

export default function Bookmark() {
  const [searchParams, updateSearchParams] = useSearchParams()
  const isImportOpen = wantsImportOpen(searchParams)
  const [refreshToken, bumpRefresh] = useState(0)

  useShellSurface({
    summary: '书签库',
    scrollable: false
  })

  function onUpdateImportOpen(open: boolean) {
    const next = new URLSearchParams(searchParams)
    if (open) {
      next.set('import', '1')
      next.delete('tab')
    } else {
      next.delete('import')
      next.delete('tab')
    }
    updateSearchParams(next, { replace: true })
  }

  return (
    <div className={styles.shell}>
      <div className={styles.surface}>
        <BookmarkLibrary
          refreshToken={refreshToken}
          onOpenImport={function () {
            onUpdateImportOpen(true)
          }}
        />
      </div>
      <BookmarkImportDialog
        open={isImportOpen}
        onUpdateOpen={onUpdateImportOpen}
        onImported={function (mirrorID) {
          void useMirrorStore.getState().toReadMirror(mirrorID)
          bumpRefresh(function (n) {
            return n + 1
          })
        }}
      />
    </div>
  )
}
