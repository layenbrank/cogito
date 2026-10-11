/**
 * 输入区：AgentSender + TriggerPopup + footer / 状态条
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { AgentSenderHandle } from './agent-sender'
import styles from './composer.module.scss'
import type { AttachCategory } from './attach-menu'
import { ComposerFooter } from './composer-footer.tsx'
import { ComposerSenderShell } from './composer-sender-shell.tsx'
import { ComposerStatusBar } from './composer-status-bar.tsx'
import type { TriggerPopupHandle } from './trigger-popup'
import type { SenderChip } from './sender-trigger'
import {
  findGooseUsage,
  formatGooseUsage,
  subscribeGooseUsage
} from '@/features/agent/acp/goose-usage'
import { compactGooseSession } from '@/features/agent/model/goose-acp'
import { findScenarioLabel, type ScenarioKey } from '@/features/agent/model/scenarios'
import { isImageFile } from '@/features/agent/model/file-icon'
import type { FilePartData } from '@/features/agent/types'
import { useAgentStore } from '@/stores/agent'
import { useProviderStore } from '@/stores/provider'
import { useComposerAttach } from './use-composer-attach.ts'
import { useComposerGit } from './use-composer-git.ts'
import { useComposerWorkspaceRoots } from './use-composer-workspace-roots.ts'

interface ComposerProps {
  value: string
  loading: boolean
  scenario: ScenarioKey
  files: FilePartData[]
  fillRequest?: { token: number; text: string } | null
  onChange: (value: string) => void
  onAttach: (file: FilePartData) => void
  onRemoveFile: (path: string) => void
  onSubmit: (fragment: string, chips?: SenderChip[]) => void
  onCancel: () => void
  onOpenSettings: () => void
}

function AgentComposer(props: ComposerProps) {
  const [attachCategory, updateAttachCategory] = useState<AttachCategory>('files')
  const [compacting, updateCompacting] = useState(false)
  const [usageLabel, updateUsageLabel] = useState<string | null>(null)
  const senderRef = useRef<AgentSenderHandle>(null)
  const popupRef = useRef<TriggerPopupHandle>(null)

  const activeSessionID = useAgentStore(function (state) {
    return state.activeSessionID
  })
  const workspace = useComposerWorkspaceRoots()
  const git = useComposerGit(workspace.primaryPath)
  const attach = useComposerAttach({
    value: props.value,
    files: props.files,
    onAttach: props.onAttach,
    onRemoveFile: props.onRemoveFile,
    senderRef
  })

  const providers = useProviderStore(function (state) {
    return state.providers
  })
  const activeProviderID = useProviderStore(function (state) {
    return state.activeProviderID
  })

  useEffect(
    function () {
      updateUsageLabel(formatGooseUsage(findGooseUsage(activeSessionID)))
      return subscribeGooseUsage(function (sessionID, usage) {
        if (sessionID !== activeSessionID) return
        updateUsageLabel(formatGooseUsage(usage))
      })
    },
    [activeSessionID]
  )

  useEffect(
    function () {
      const request = props.fillRequest
      if (!request) return
      senderRef.current?.writePlainText(request.text)
    },
    [props.fillRequest]
  )

  const activeProvider = providers.find(function (provider) {
    return provider.id === activeProviderID && provider.enabled
  })
  const modelLabel = activeProvider
    ? `${activeProvider.model || '未选模型'} · ${activeProvider.name || activeProvider.kind}`
    : '选择模型'

  const scenarioLabel = findScenarioLabel(props.scenario)

  const imageFiles = useMemo(
    function () {
      return props.files.filter(function (file) {
        return isImageFile(file.name) || isImageFile(file.path)
      })
    },
    [props.files]
  )

  const branchItems = git.branches.map(function (item) {
    return {
      key: item,
      label: item,
      current: item === git.branch
    }
  })

  function handleCompact() {
    if (!activeSessionID) {
      toast.warning('请先发送一条消息后再压缩')
      return
    }
    updateCompacting(true)
    void compactGooseSession(activeSessionID)
      .then(function () {
        toast.success('已请求 goose 压缩上下文')
      })
      .catch(function (error) {
        console.error('[composer] compact failed:', error)
        const detail = error instanceof Error ? error.message : '压缩失败'
        toast.error(detail)
      })
      .finally(function () {
        updateCompacting(false)
      })
  }

  return (
    <div className={styles.root}>
      <ComposerSenderShell
        senderRef={senderRef}
        popupRef={popupRef}
        loading={props.loading}
        triggerMatch={attach.triggerMatch}
        rootPaths={workspace.rootPaths}
        chipPaths={attach.chipPaths}
        imageFiles={imageFiles}
        placeholder={
          props.scenario === 'general'
            ? '输入消息，Enter 发送，Shift+Enter 换行；@ 引用文件，/ 引用技能'
            : `场景：${scenarioLabel}，描述需求后发送`
        }
        footer={
          <ComposerFooter
            senderRef={senderRef}
            roots={workspace.roots}
            attachOpen={attach.attachOpen}
            attachCategory={attachCategory}
            onAttachOpenChange={attach.updateAttachOpen}
            onAttachCategoryChange={updateAttachCategory}
            onAttachOpenSideEffects={function () {
              updateAttachCategory('files')
              attach.handleTriggerClose()
            }}
            onAttachFile={attach.handleAttach}
            onAttachSkill={attach.handleAttachSkill}
            onPickImages={function () {
              void attach.handlePickImages()
            }}
            onPickFiles={function () {
              void attach.handlePickFiles()
            }}
            onPickFolders={function () {
              void attach.handlePickFolders()
            }}
            usageLabel={usageLabel}
            compacting={compacting}
            loading={props.loading}
            activeSessionID={activeSessionID}
            onCompact={handleCompact}
            modelLabel={modelLabel}
            onOpenSettings={props.onOpenSettings}
            canSend={attach.canSend}
            onCancel={props.onCancel}
          />
        }
        onChange={props.onChange}
        onCanSendChange={attach.updateCanSend}
        onSyncChipPaths={attach.syncChipPaths}
        onSubmit={props.onSubmit}
        onRemoveFile={props.onRemoveFile}
        onAttachImage={props.onAttach}
        onPasteImages={attach.handlePasteImages}
        onTriggerChange={attach.handleTriggerChange}
        onTriggerClose={attach.handleTriggerClose}
        onTriggerPickDone={function () {
          attach.updateTriggerMatch(null)
        }}
        suppressedTriggerKey={attach.suppressedTriggerKey}
      />
      <ComposerStatusBar
        workspaceTitle={workspace.activeWorkspace?.title ?? null}
        showGit={git.showGit}
        branch={git.branch}
        branchLoading={git.branchLoading}
        branchOpen={git.branchOpen}
        onBranchOpenChange={git.updateBranchOpen}
        branchItems={branchItems}
        onCheckout={function (next) {
          void git.checkout(next)
        }}
      />
    </div>
  )
}

export { AgentComposer }
export type { ComposerProps }
