import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Label } from '@i-thinking/design/components/label'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from '@i-thinking/design/components/sheet'
import { Switch } from '@i-thinking/design/components/switch'

import { useMarkdownStore } from '@/stores/markdown'
import { pickRootDirectory } from '@/views/markdown/lib/fs.ts'
import { t } from '@/views/markdown/locale.ts'

function PreferencesSheet() {
  const isPrefsOpen = useMarkdownStore(function (state) {
    return state.isPrefsOpen
  })
  const toSetPrefsOpen = useMarkdownStore(function (state) {
    return state.toSetPrefsOpen
  })
  const fontSize = useMarkdownStore(function (state) {
    return state.fontSize
  })
  const contentMaxWidth = useMarkdownStore(function (state) {
    return state.contentMaxWidth
  })
  const autosaveMs = useMarkdownStore(function (state) {
    return state.autosaveMs
  })
  const isTypographyEnabled = useMarkdownStore(function (state) {
    return state.isTypographyEnabled
  })
  const isTypewriter = useMarkdownStore(function (state) {
    return state.isTypewriter
  })
  const rootDir = useMarkdownStore(function (state) {
    return state.rootDir
  })
  const toPatchPreferences = useMarkdownStore(function (state) {
    return state.toPatchPreferences
  })

  async function onPickRoot() {
    const root = await pickRootDirectory()
    if (root) toPatchPreferences({ rootDir: root })
  }

  return (
    <Sheet
      open={isPrefsOpen}
      onOpenChange={toSetPrefsOpen}>
      <SheetContent
        side="right"
        className="w-[360px] sm:max-w-[360px]">
        <SheetHeader>
          <SheetTitle>{t('PREFERENCES')}</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-5 px-1">
          <div className="space-y-2">
            <Label>{t('PREF_ROOT')}</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={rootDir ?? ''}
                className="h-8 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={function () {
                  void onPickRoot()
                }}>
                …
              </Button>
            </div>
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
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { PreferencesSheet }
