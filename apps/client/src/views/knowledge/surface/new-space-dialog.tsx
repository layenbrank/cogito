/**
 * 新建空间：名称输入 + 场景模板卡片。
 *
 * 取代原来侧栏里「Input + Select + 一个『建』按钮」那套挤在一起的表单——
 * 新建空间是低频但高权重的动作，值一个正经弹窗（语雀 / Notion 都是这么做）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import {
  RadioGroup,
  RadioGroupItem
} from '@cogito/design/components/radio-group'
import { cn } from 'cn'
import { useState } from 'react'

import { useSpacesStore } from '@/stores/spaces'
import { t } from '@/views/knowledge/locale.ts'
import {
  WIKI_TEMPLATES,
  WIKI_TEMPLATE_GENERAL
} from '@/views/knowledge/lib/wiki-templates.ts'

interface NewSpaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function NewSpaceDialog(props: NewSpaceDialogProps) {
  const [name, setName] = useState('')
  const [templateID, setTemplateID] = useState<string>(WIKI_TEMPLATE_GENERAL)
  const [isSubmitting, setSubmitting] = useState(false)
  const trimmed = name.trim()

  function reset() {
    setName('')
    setTemplateID(WIKI_TEMPLATE_GENERAL)
    setSubmitting(false)
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    props.onOpenChange(next)
  }

  async function handleCreate() {
    if (!trimmed || isSubmitting) return
    setSubmitting(true)
    let ok = false
    try {
      // store 内部已 catch 并上报（reportCaught + error 态），这里只看结果
      ok = await useSpacesStore.getState().addSpace(trimmed, templateID)
    } finally {
      setSubmitting(false)
    }
    if (ok) handleOpenChange(false)
  }

  async function handleImportSample() {
    if (isSubmitting) return
    setSubmitting(true)
    let ok = false
    try {
      ok = await useSpacesStore.getState().importExample()
    } finally {
      setSubmitting(false)
    }
    if (ok) handleOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('SPACE_NEW')}</DialogTitle>
          <DialogDescription>
            空间是文档的容器：一个主题一个空间，里面的默认视图就是编辑器。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Input
            autoFocus
            value={name}
            className="h-10 text-sm"
            placeholder={t('SPACE_NAME_PLACEHOLDER')}
            onChange={function (event) {
              setName(event.target.value)
            }}
            onKeyDown={function (event) {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void handleCreate()
            }}
          />

          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs font-medium">{t('SPACE_TEMPLATE')}</p>
            <RadioGroup
              value={templateID}
              onValueChange={function (value) {
                if (typeof value === 'string') setTemplateID(value)
              }}
              className="grid max-h-[300px] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {WIKI_TEMPLATES.map(function (template) {
                const isActive = template.id === templateID
                return (
                  <Label
                    key={template.id}
                    className={cn(
                      'flex cursor-pointer flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
                      'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40',
                      isActive
                        ? 'border-primary/60 bg-primary/5'
                        : 'border-border hover:border-foreground/25 hover:bg-muted/40'
                    )}>
                    <RadioGroupItem
                      value={template.id}
                      className="sr-only"
                    />
                    <span className="flex w-full items-center gap-2">
                      <Icon
                        icon={template.icon}
                        className={cn(
                          'size-4',
                          isActive ? 'text-primary' : 'text-muted-foreground'
                        )}
                      />
                      <span className="text-[13px] font-medium">{template.name}</span>
                      {isActive ? (
                        <Icon
                          icon="lucide:check"
                          className="text-primary ml-auto size-3.5"
                        />
                      ) : null}
                    </span>
                    <span className="text-muted-foreground line-clamp-2 text-[11px] leading-relaxed">
                      {template.description}
                    </span>
                  </Label>
                )
              })}
            </RadioGroup>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={isSubmitting}
            className="mr-auto"
            onClick={function () {
              void handleImportSample()
            }}>
            {t('SPACE_IMPORT_SAMPLE')}
          </Button>
          <Button
            type="button"
            disabled={!trimmed || isSubmitting}
            onClick={function () {
              void handleCreate()
            }}>
            {t('SPACE_CREATE')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { NewSpaceDialog }
