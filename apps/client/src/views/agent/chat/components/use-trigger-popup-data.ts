import { useEffect, useRef, useState } from 'react'

import {
  BEHAVIOR_PICK_FILE,
  BEHAVIOR_PICK_SKILL
} from './sender-trigger'
import { WorkspaceFiles, type SearchHit } from '@/lib/workspace-files'
import { WorkspaceSkills, type WorkspaceSkill } from '@/lib/workspace-skills'

const SEARCH_LIMIT = 50
const DEBOUNCE_MS = 120

interface UseTriggerPopupDataInput {
  open: boolean
  behaviorId: string
  query: string
  rootPaths: string[]
}

interface UseTriggerPopupDataResult {
  fileHits: SearchHit[]
  skills: WorkspaceSkill[]
  isListLoading: boolean
}

function useTriggerPopupData(input: UseTriggerPopupDataInput): UseTriggerPopupDataResult {
  const [fileHits, updateFileHits] = useState<SearchHit[]>([])
  const [skills, updateSkills] = useState<WorkspaceSkill[]>([])
  const [loading, updateLoading] = useState(false)
  const seq = useRef(0)

  const hasRoots = input.rootPaths.length > 0
  const canSearchFiles = input.open && input.behaviorId === BEHAVIOR_PICK_FILE && hasRoots
  const canFetchSkills = input.open && input.behaviorId === BEHAVIOR_PICK_SKILL && hasRoots

  useEffect(
    function () {
      if (!canSearchFiles) return

      let cancelled = false
      const nextSeq = ++seq.current
      const timer = window.setTimeout(function () {
        updateLoading(true)
        void WorkspaceFiles.search(input.rootPaths, input.query, SEARCH_LIMIT)
          .then(function (hits) {
            if (cancelled || seq.current !== nextSeq) return
            updateFileHits(hits)
            updateLoading(false)
          })
          .catch(function (error: unknown) {
            console.warn('[trigger-popup] 文件搜索失败，回落空结果:', error)
            if (cancelled || seq.current !== nextSeq) return
            updateFileHits([])
            updateLoading(false)
          })
      }, DEBOUNCE_MS)

      return function () {
        cancelled = true
        window.clearTimeout(timer)
      }
    },
    [canSearchFiles, input.query, input.rootPaths]
  )

  useEffect(
    function () {
      if (!canFetchSkills) return

      let cancelled = false
      const nextSeq = ++seq.current
      void Promise.resolve()
        .then(function () {
          if (cancelled) return
          updateLoading(true)
          return WorkspaceSkills.fetchSkills(input.rootPaths)
        })
        .then(function (rows) {
          if (cancelled || seq.current !== nextSeq || rows === undefined) return
          updateSkills(rows)
          updateLoading(false)
        })
        .catch(function (error: unknown) {
          console.warn('[trigger-popup] skill 列表拉取失败，回落空结果:', error)
          if (cancelled || seq.current !== nextSeq) return
          updateSkills([])
          updateLoading(false)
        })

      return function () {
        cancelled = true
      }
    },
    [canFetchSkills, input.rootPaths]
  )

  return {
    fileHits,
    skills,
    isListLoading: loading && (canSearchFiles || canFetchSkills)
  }
}

export { useTriggerPopupData }
