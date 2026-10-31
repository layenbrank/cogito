import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

import { openFolderAsWorkspace } from '@/views/knowledge/lib/session.ts'
import { t } from '@/views/knowledge/locale.ts'

function NavigationEmpty() {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 border-r border-border/50 bg-background/65 px-4 text-center backdrop-blur-md">
      <Icon
        icon="lucide:folder-open"
        className="size-8 text-muted-foreground/70"
      />
      <p
        className="text-foreground text-sm font-medium"
        title={t('TREE_NO_ROOT_DESC')}>
        {t('TREE_NO_ROOT_TITLE')}
      </p>
      <Button
        type="button"
        size="sm"
        onClick={function () {
          void openFolderAsWorkspace()
        }}>
        <Icon
          icon="lucide:folder-open"
          className="size-3.5"
        />
        {t('OPEN_FOLDER')}
      </Button>
    </div>
  )
}

export { NavigationEmpty }
