import type { ReactNode, RefObject } from 'react'

import { AgentSender, type AgentSenderHandle } from './agent-sender'
import styles from './composer.module.scss'
import { TriggerPopup, type TriggerPopupHandle } from './trigger-popup'
import type { TriggerMatch, SenderChip } from './sender-trigger'
import { isImageFile } from '@/features/agent/model/file-icon'
import { normalizePath } from '@/features/agent/model/workspace-path'
import type { FilePartData } from '@/features/agent/types'

interface ComposerSenderShellProps {
  senderRef: RefObject<AgentSenderHandle | null>
  popupRef: RefObject<TriggerPopupHandle | null>
  loading: boolean
  triggerMatch: TriggerMatch | null
  rootPaths: string[]
  chipPaths: string[]
  imageFiles: FilePartData[]
  placeholder: string
  footer: ReactNode
  onChange: (value: string) => void
  onCanSendChange: (canSend: boolean) => void
  onSyncChipPaths: () => void
  onSubmit: (value: string, chips?: SenderChip[]) => void
  onRemoveFile: (path: string) => void
  onAttachImage: (file: FilePartData) => void
  onPasteImages: (files: File[]) => void
  onTriggerChange: (match: TriggerMatch | null) => void
  onTriggerClose: () => void
  onTriggerPickDone: () => void
  suppressedTriggerKey: RefObject<string | null>
}

function ComposerSenderShell(props: ComposerSenderShellProps) {
  return (
    <div className={styles.senderShell}>
      <TriggerPopup
        ref={props.popupRef}
        match={props.triggerMatch}
        rootPaths={props.rootPaths}
        excludedPaths={props.chipPaths}
        onPick={function (chip) {
          props.senderRef.current?.insertChip(chip)
          const path = chip.meta.path ? normalizePath(chip.meta.path) : ''
          const name = chip.meta.name || chip.label
          if (chip.kind === 'file' && path && name) {
            if (isImageFile(name) || isImageFile(path)) {
              props.onAttachImage({ path, name })
            }
          }
          props.onSyncChipPaths()
          props.suppressedTriggerKey.current = null
          props.onTriggerPickDone()
        }}
        onClose={props.onTriggerClose}
      />
      <AgentSender
        ref={props.senderRef}
        loading={props.loading}
        blockSubmit={Boolean(props.triggerMatch)}
        images={props.imageFiles}
        placeholder={props.placeholder}
        autoSize={{
          minRows: 1,
          maxRows: 6
        }}
        footer={props.footer}
        onChange={function (value) {
          props.onChange(value)
          props.onCanSendChange(value.trim().length > 0)
          props.onSyncChipPaths()
        }}
        onSubmit={function (value) {
          props.onSubmit(value, props.senderRef.current?.findChips() ?? [])
        }}
        onRemoveImage={function (path) {
          props.senderRef.current?.removeChipByPath(path)
          props.onRemoveFile(path)
        }}
        onPasteImages={function (files) {
          void props.onPasteImages(files)
        }}
        onTriggerChange={props.onTriggerChange}
        onTriggerKeyDown={function (event) {
          return props.popupRef.current?.handleKeyDown(event) ?? false
        }}
      />
    </div>
  )
}

export { ComposerSenderShell }
