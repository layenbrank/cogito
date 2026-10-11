import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@i-thinking/design/components/popover'
import { Spinner } from '@i-thinking/design/components/spinner'
import type { RefObject } from 'react'

import { AttachMenu, type AttachCategory, type WorkspaceRoot } from './attach-menu'
import styles from './composer.module.scss'
import { AgentModelPicker } from './model-picker'
import type { AgentSenderHandle } from './agent-sender'
import type { FilePartData } from '@/features/agent/types'

interface ComposerFooterProps {
  senderRef: RefObject<AgentSenderHandle | null>
  roots: WorkspaceRoot[]
  attachOpen: boolean
  attachCategory: AttachCategory
  onAttachOpenChange: (open: boolean) => void
  onAttachCategoryChange: (category: AttachCategory) => void
  onAttachOpenSideEffects: () => void
  onAttachFile: (file: FilePartData, relative?: string) => void
  onAttachSkill: (file: FilePartData, relative?: string) => void
  onPickImages: () => void
  onPickFiles: () => void
  onPickFolders: () => void
  usageLabel: string | null
  compacting: boolean
  loading: boolean
  activeSessionID: string | null
  onCompact: () => void
  modelLabel: string
  onOpenSettings: () => void
  canSend: boolean
  onCancel: () => void
}

function ComposerFooter(props: ComposerFooterProps) {
  return (
    <div className={`${styles.footer} flex items-center gap-1.5`}>
      <div className={`${styles.footerStart} flex items-center gap-0.5`}>
        <Popover
          open={props.attachOpen}
          onOpenChange={function (open) {
            props.onAttachOpenChange(open)
            if (open) props.onAttachOpenSideEffects()
          }}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={styles.footerBtn}
                aria-label="添加"
              />
            }>
            <Icon icon="mdi:plus" />
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="w-auto gap-0 border-0 bg-transparent p-0 ring-0 shadow-none">
            <AttachMenu
              roots={props.roots}
              category={props.attachCategory}
              onCategoryChange={props.onAttachCategoryChange}
              onAttach={function (file: FilePartData, relative?: string) {
                if (props.attachCategory === 'skills') {
                  props.onAttachSkill(file, relative)
                  return
                }
                props.onAttachFile(file, relative)
              }}
            />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={styles.footerBtn}
                aria-label="附加文件"
              />
            }>
            <Icon icon="mdi:paperclip" />
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="w-auto gap-0 p-1">
            <div className={styles.attachMenu}>
              <button
                type="button"
                className={styles.attachItem}
                onClick={props.onPickImages}>
                <Icon
                  icon="mdi:image-outline"
                  width={14}
                  height={14}
                />
                添加图片
              </button>
              <button
                type="button"
                className={styles.attachItem}
                onClick={props.onPickFiles}>
                <Icon
                  icon="mdi:file-outline"
                  width={14}
                  height={14}
                />
                添加文件
              </button>
              <button
                type="button"
                className={styles.attachItem}
                onClick={props.onPickFolders}>
                <Icon
                  icon="mdi:folder-outline"
                  width={14}
                  height={14}
                />
                添加文件夹
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div className={`${styles.footerEnd} flex items-center gap-1.5`}>
        {props.usageLabel ? (
          <span
            className={styles.usageLabel}
            title="当前会话上下文用量">
            {props.usageLabel}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          className={styles.footerBtn}
          aria-label="压缩上下文"
          title="压缩上下文"
          disabled={props.compacting || props.loading || !props.activeSessionID}
          onClick={props.onCompact}>
          {props.compacting ? (
            <Spinner />
          ) : (
            <Icon
              icon="mdi:arrow-collapse-vertical"
              width={14}
              height={14}
            />
          )}
        </Button>
        <AgentModelPicker onOpenSettings={props.onOpenSettings}>
          <Button
            variant="ghost"
            className={styles.modelBtn}>
            <Icon
              icon="mdi:api"
              width={14}
              height={14}
            />
            <span className={styles.modelLabel}>{props.modelLabel}</span>
          </Button>
        </AgentModelPicker>
        {props.loading ? (
          <Button
            variant="destructive"
            size="icon-sm"
            className={styles.sendBtn}
            aria-label="停止"
            onClick={props.onCancel}>
            <Icon
              icon="mdi:stop"
              width={16}
              height={16}
            />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            className={styles.sendBtn}
            aria-label="发送"
            disabled={!props.canSend}
            onClick={function () {
              props.senderRef.current?.submit()
            }}>
            <Icon
              icon="mdi:arrow-up"
              width={16}
              height={16}
            />
          </Button>
        )}
      </div>
    </div>
  )
}

export { ComposerFooter }
