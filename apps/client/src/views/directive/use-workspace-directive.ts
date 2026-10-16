import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { SHORTCUT_COMMAND } from '@/keyboard/definitions'
import { useCommands } from '@/keyboard/react'
import { useCorexStore } from '@/stores/corex.ts'
import { nextStepId, nextToken } from '@/views/directive/model/step-utils.ts'
import type { Step } from '@/views/directive/model/types.ts'

interface UseWorkspaceOptions {
  name: string
  isPending: boolean
  isDirty: boolean
  onOpenRunPanel: () => void
}

function useWorkspaceDirective(options: UseWorkspaceOptions) {
  const { name, isPending, isDirty, onOpenRunPanel } = options
  const navigate = useNavigate()

  const draft = useCorexStore(function (state) {
    return state.draft
  })
  const initialize = useCorexStore(function (state) {
    return state.initialize
  })
  const openEditor = useCorexStore(function (state) {
    return state.openEditor
  })
  const seedPendingDraft = useCorexStore(function (state) {
    return state.seedPendingDraft
  })
  const loadEditor = useCorexStore(function (state) {
    return state.loadEditor
  })
  const closeEditor = useCorexStore(function (state) {
    return state.closeEditor
  })
  const replaceDraft = useCorexStore(function (state) {
    return state.replaceDraft
  })
  const setSelectedToken = useCorexStore(function (state) {
    return state.setSelectedToken
  })
  const undoDraft = useCorexStore(function (state) {
    return state.undoDraft
  })
  const redoDraft = useCorexStore(function (state) {
    return state.redoDraft
  })
  const validateDraft = useCorexStore(function (state) {
    return state.validateDraft
  })
  const saveDraft = useCorexStore(function (state) {
    return state.saveDraft
  })
  const startRun = useCorexStore(function (state) {
    return state.startRun
  })
  const deleteDirectiveFromHost = useCorexStore(function (state) {
    return state.deleteDirectiveFromHost
  })

  useEffect(
    function () {
      void initialize()
    },
    [initialize]
  )

  useEffect(
    function () {
      if (!name) return
      openEditor(name, isPending)
      if (isPending) {
        seedPendingDraft(name)
        return function () {
          closeEditor()
        }
      }
      void loadEditor(name)
        .then(function () {
          const current = useCorexStore.getState().draft
          // zod 推出来的 steps 元素与 model 的 Step 不是同一份联合，得先按 Step[] 收
          const steps = (current?.steps ?? []) as Step[]
          const first = steps[0]
          if (first?.token) setSelectedToken(first.token)
        })
        .catch(function (error) {
          toast.error('加载指令失败', {
            description: error instanceof Error ? error.message : String(error)
          })
        })
      return function () {
        closeEditor()
      }
    },
    [name, isPending, openEditor, seedPendingDraft, loadEditor, closeEditor, setSelectedToken]
  )

  const handleSave = useCallback(
    async function () {
      const savedName = await saveDraft()
      if (savedName && savedName !== name) {
        void navigate('/directive/' + encodeURIComponent(savedName), { replace: true })
      }
    },
    [saveDraft, name, navigate]
  )

  const handleValidate = useCallback(
    async function () {
      try {
        await validateDraft()
        toast.success('校验通过')
      } catch (error) {
        toast.error('校验失败', {
          description: error instanceof Error ? error.message : String(error)
        })
      }
    },
    [validateDraft]
  )

  const handleOnce = useCallback(
    async function () {
      const target = draft?.name ?? name
      if (!target) return
      if (isDirty) {
        const saved = await saveDraft()
        if (!saved) return
        onOpenRunPanel()
        startRun(saved, {})
        return
      }
      onOpenRunPanel()
      startRun(target, {})
    },
    [draft?.name, name, isDirty, saveDraft, startRun, onOpenRunPanel]
  )

  const beforeGuard = useCallback(
    async function () {
      if (!isDirty) return draft?.name ?? name
      try {
        return await saveDraft()
      } catch (error) {
        // 存草稿失败不能阻断运行链路，但原因要留下
        console.warn('[directive] 保存草稿失败:', error)
        return null
      }
    },
    [isDirty, draft?.name, name, saveDraft]
  )

  const handleDelete = useCallback(
    async function () {
      const target = draft?.name ?? name
      await deleteDirectiveFromHost(target)
      toast.success('已删除')
    },
    [deleteDirectiveFromHost, draft?.name, name]
  )

  // 键位在 `keyboard/definitions.ts`，这里只声明「做什么」。
  //
  // 原来那段 window keydown 里 `if (event.key === 'Enter') void handleOnce()` 永远走不到 ——
  // 前面 `if (!withMod) return` 已经把无修饰键的按键挡掉了，所以「单键 Enter 运行」从未生效。
  // 迁移时直接删掉，不留死代码；`handleOnce` 仍由界面按钮使用。
  useCommands([
    {
      id: SHORTCUT_COMMAND.DIRECTIVE_SAVE,
      title: '编排：保存草稿',
      keywords: 'save',
      group: '编排',
      run: handleSave
    },
    {
      id: SHORTCUT_COMMAND.DIRECTIVE_VALIDATE,
      title: '编排：校验',
      keywords: 'validate',
      group: '编排',
      run: handleValidate
    },
    {
      id: SHORTCUT_COMMAND.DIRECTIVE_UNDO,
      title: '编排：撤销',
      keywords: 'undo',
      group: '编排',
      run: undoDraft
    },
    {
      id: SHORTCUT_COMMAND.DIRECTIVE_REDO,
      title: '编排：重做',
      keywords: 'redo',
      group: '编排',
      run: redoDraft
    }
  ])

  function insertAction(actionId: string) {
    if (!draft) return
    const siblings = draft.steps as Step[]
    const step: Step = {
      id: nextStepId(actionId, siblings),
      token: nextToken(),
      action: actionId,
      params: {}
    }
    replaceDraft({
      ...draft,
      steps: [...siblings, step] as typeof draft.steps
    })
    setSelectedToken(step.token ?? null)
  }

  return {
    draft,
    replaceDraft,
    setSelectedToken,
    undoDraft,
    redoDraft,
    handleSave,
    handleValidate,
    handleOnce,
    beforeGuard,
    handleDelete,
    insertAction
  }
}

export { useWorkspaceDirective }
