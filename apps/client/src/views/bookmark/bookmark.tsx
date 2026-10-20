import { useMemo, useState } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import styles from '@/views/bookmark/bookmark.module.scss'
import { BookmarkImportSheet } from '@/views/bookmark/import-sheet'
import { BookmarkLibrary } from '@/views/bookmark/library'

function findInitialImportOpen() {
  const params = new URLSearchParams(location.search)
  if (params.get('import') === '1') return true
  if (params.get('tab') === 'import') return true
  return false
}

export default function Bookmark() {
  const initialImportOpen = useMemo(function () {
    return findInitialImportOpen()
  }, [])
  const [isImportOpen, setImportOpen] = useState(initialImportOpen)
  const [refreshToken, bumpRefresh] = useState(0)

  return (
    <Decorations
      summary="书签库"
      scrollable={false}>
      <div className={styles.shell}>
        <div className={styles.panel}>
          <BookmarkLibrary
            refreshToken={refreshToken}
            onOpenImport={function () {
              setImportOpen(true)
            }}
          />
        </div>
        <BookmarkImportSheet
          open={isImportOpen}
          onUpdateOpen={setImportOpen}
          onImported={function () {
            bumpRefresh(function (n) {
              return n + 1
            })
          }}
        />
      </div>
    </Decorations>
  )
}
