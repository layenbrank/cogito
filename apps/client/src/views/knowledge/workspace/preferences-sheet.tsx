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
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from '@cogito/design/components/sheet'
import { Switch } from '@cogito/design/components/switch'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { removeLegacy, scanLegacy, type LegacyBackup } from '@/lib/knowledge-ipc'
import { useKnowledgeStore } from '@/stores/knowledge'
import { formatSize } from '@/views/knowledge/lib/stats.ts'
import { t } from '@/views/knowledge/locale.ts'

function PreferencesSheet() {
  const isPrefsOpen = useKnowledgeStore(function (state) {
    return state.isPrefsOpen
  })
  const toSetPrefsOpen = useKnowledgeStore(function (state) {
    return state.toSetPrefsOpen
  })
  const fontSize = useKnowledgeStore(function (state) {
    return state.fontSize
  })
  const contentMaxWidth = useKnowledgeStore(function (state) {
    return state.contentMaxWidth
  })
  const autosaveMs = useKnowledgeStore(function (state) {
    return state.autosaveMs
  })
  const isTypographyEnabled = useKnowledgeStore(function (state) {
    return state.isTypographyEnabled
  })
  const isTypewriter = useKnowledgeStore(function (state) {
    return state.isTypewriter
  })
  const rootDir = useKnowledgeStore(function (state) {
    return state.rootDir
  })
  const toPatchPreferences = useKnowledgeStore(function (state) {
    return state.toPatchPreferences
  })

  // 旧版自动备份：只在真有残留时出现（没有就不打扰）
  const [legacy, setLegacy] = useState<LegacyBackup | null>(null)
  const [isLegacyConfirmOpen, toSetLegacyConfirmOpen] = useState(false)
  const [isLegacyBusy, toSetLegacyBusy] = useState(false)

  useEffect(
    function () {
      if (!isPrefsOpen) return
      let isCancelled = false
      scanLegacy()
        .then(function (found) {
          if (!isCancelled) setLegacy(found)
        })
        .catch(function (error) {
          console.warn('[knowledge-prefs] 检查旧备份失败:', error)
        })
      return function () {
        isCancelled = true
      }
    },
    [isPrefsOpen]
  )

  async function toRemoveLegacy() {
    toSetLegacyBusy(true)
    try {
      const freed = await removeLegacy()
      setLegacy(null)
      toast.success(`${t('PREF_LEGACY_DONE')}（释放 ${formatSize(freed)}）`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      toSetLegacyBusy(false)
      toSetLegacyConfirmOpen(false)
    }
  }

  return (
    <Sheet
      open={isPrefsOpen}
      onOpenChange={toSetPrefsOpen}>
      <SheetContent
        side="right"
        className="w-90 sm:max-w-90">
        <SheetHeader>
          <SheetTitle>{t('PREFERENCES')}</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-5 px-1">
          <div className="space-y-2">
            <Label>{t('PREF_ROOT')}</Label>
            {/* 根目录由当前知识库决定（切库就变），这里只看不改 */}
            <Input
              readOnly
              value={rootDir ?? ''}
              className="h-8 text-xs"
            />
            <p className="text-xs text-muted-foreground">{t('PREF_ROOT_HINT')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="md-font">{t('PREF_FONT')}</Label>
            <Input
              id="md-font"
              type="number"
              min={12}
              max={28}
              value={fontSize}
              className="h-8"
              onChange={function (event) {
                toPatchPreferences({ fontSize: Number(event.target.value) || 16 })
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="md-width">{t('PREF_WIDTH')}</Label>
            <Input
              id="md-width"
              type="number"
              min={480}
              max={1200}
              value={contentMaxWidth}
              className="h-8"
              onChange={function (event) {
                toPatchPreferences({
                  contentMaxWidth: Number(event.target.value) || 760
                })
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="md-autosave">{t('PREF_AUTOSAVE')}</Label>
            <Input
              id="md-autosave"
              type="number"
              min={0}
              step={500}
              value={autosaveMs}
              className="h-8"
              onChange={function (event) {
                toPatchPreferences({
                  autosaveMs: Math.max(0, Number(event.target.value) || 0)
                })
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="md-typo">{t('PREF_TYPOGRAPHY')}</Label>
            <Switch
              id="md-typo"
              checked={isTypographyEnabled}
              onCheckedChange={function (checked) {
                toPatchPreferences({ isTypographyEnabled: checked })
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="md-typewriter">{t('PREF_TYPEWRITER')}</Label>
            <Switch
              id="md-typewriter"
              checked={isTypewriter}
              onCheckedChange={function (checked) {
                toPatchPreferences({ isTypewriter: checked })
              }}
            />
          </div>
          {legacy ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <Label>{t('PREF_LEGACY')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('PREF_LEGACY_HINT')}
              </p>
              <p className="text-xs text-muted-foreground">
                {legacy.files} 个文件 · {formatSize(legacy.bytes)}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={isLegacyBusy}
                onClick={function () {
                  toSetLegacyConfirmOpen(true)
                }}>
                {t('PREF_LEGACY_BUTTON')}
              </Button>
            </div>
          ) : null}
        </div>
      </SheetContent>
      <AlertDialog
        open={isLegacyConfirmOpen}
        onOpenChange={toSetLegacyConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('PREF_LEGACY_CONFIRM_TITLE')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('PREF_LEGACY_CONFIRM_DESC')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('CONFIRM_CANCEL')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isLegacyBusy}
              onClick={toRemoveLegacy}>
              {t('CONFIRM_REMOVE')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  )
}

export { PreferencesSheet }
