import { Sheet, SheetContent, SheetTitle } from '@cogito/design/components/sheet'

import { BookmarkImportWizard } from '@/views/bookmark/wizard'

type ImportSheetProps = {
  open: boolean
  onUpdateOpen: (open: boolean) => void
  onImported: (mirrorID: string) => void
}

function BookmarkImportSheet(props: ImportSheetProps) {
  return (
    <Sheet
      open={props.open}
      onOpenChange={props.onUpdateOpen}>
      <SheetContent
        side="right"
        showCloseButton
        overlayClassName="bg-black/20 supports-backdrop-filter:backdrop-blur-xs"
        className={[
          'h-full w-[min(960px,94vw)] max-w-none gap-0 p-0 sm:max-w-none',
          '**:data-[slot=dialog-body]:flex **:data-[slot=dialog-body]:min-h-0 **:data-[slot=dialog-body]:flex-1',
          '**:data-[slot=dialog-body]:flex-col **:data-[slot=dialog-body]:gap-0',
          '**:data-[slot=dialog-body]:overflow-hidden **:data-[slot=dialog-body]:p-0 **:data-[slot=dialog-body]:pb-0'
        ].join(' ')}>
        <SheetTitle className="sr-only">导入书签</SheetTitle>
        <BookmarkImportWizard
          onImported={function (mirrorID) {
            props.onImported(mirrorID)
            props.onUpdateOpen(false)
          }}
        />
      </SheetContent>
    </Sheet>
  )
}

export { BookmarkImportSheet }
