import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Progress } from '@i-thinking/design/components/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'

import { useMirrorStore } from '@/stores/mirror'
import styles from '@/views/bookmark/bookmark.module.scss'
import { BookmarkExplorer } from '@/views/bookmark/explorer'
import type { ChromeProfileBookmarks } from '@/views/bookmark/import/chrome-profile'
import {
  commitBookmarkImport,
  type CommitProgress
} from '@/views/bookmark/import/commit'
import { flattenBookmarkLeaves } from '@/views/bookmark/import/flatten'
import {
  discoverChromeProfiles,
  previewFromHtmlFile
} from '@/views/bookmark/import/preview'
import { findDefaultSelectedFolders, findSelectedLeaves } from '@/views/bookmark/import/tree'
import type { DuplicateStrategy, ImportPreview } from '@/views/bookmark/import/types'
import {
  readSortKey,
  readViewMode,
  writeSortKey,
  writeViewMode,
  type BookmarkSortKey,
  type BookmarkViewMode
} from '@/views/bookmark/view-prefs'

type WizardProps = {
  onImported?: (mirrorID: string) => void
}

const STRATEGY_ITEMS = [
  { value: 'skip', label: '跳过' },
  { value: 'overwrite', label: '覆盖' }
] as const

function BookmarkImportWizard(props: WizardProps) {
  const { mirrors, activeMirrorID } = useMirrorStore(
    useShallow(function (state) {
      return {
        mirrors: state.mirrors,
        activeMirrorID: state.active.mirror?.id ?? null
      }
    })
  )

  const mirrorItems = useMemo(
    function () {
      return mirrors.map(function (mirror) {
        return { value: mirror.id, label: mirror.title }
      })
    },
    [mirrors]
  )

  const [mirrorID, setMirrorID] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [selectedFolders, setSelectedFolders] = useState<string[]>([])
  const [strategy, setStrategy] = useState<DuplicateStrategy>('skip')
  const [profiles, setProfiles] = useState<ChromeProfileBookmarks[]>([])
  const [isBusy, setBusy] = useState(false)
  const [progress, setProgress] = useState<CommitProgress | null>(null)
  const [viewMode, setViewMode] = useState<BookmarkViewMode>(readViewMode)
  const [sortKey, setSortKey] = useState<BookmarkSortKey>(readSortKey)

  const resolvedMirrorID = useMemo(
    function () {
      if (
        mirrorID &&
        mirrors.some(function (mirror) {
          return mirror.id === mirrorID
        })
      ) {
        return mirrorID
      }
      return activeMirrorID ?? ''
    },
    [mirrorID, mirrors, activeMirrorID]
  )

  useEffect(function () {
    let cancelled = false
    void discoverChromeProfiles()
      .then(function (list) {
        if (!cancelled) setProfiles(list)
      })
      .catch(function (error) {
        console.warn('[bookmark-import] 发现 Chrome Profile 失败', error)
      })
    return function () {
      cancelled = true
    }
  }, [])

  const selectedLeaves = useMemo(
    function () {
      if (!preview) return []
      return findSelectedLeaves(preview.leaves, selectedFolders)
    },
    [preview, selectedFolders]
  )

  function applyPreview(next: ImportPreview) {
    setPreview(next)
    setSelectedFolders(findDefaultSelectedFolders(next.roots))
  }

  async function onPickHtml() {
    try {
      setBusy(true)
      const next = await previewFromHtmlFile()
      if (!next) return
      applyPreview(next)
      toast.success(`已解析 ${next.leaves.length} 条链接`)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : '解析 HTML 失败')
    } finally {
      setBusy(false)
    }
  }

  function onPickProfile(profile: ChromeProfileBookmarks) {
    applyPreview({
      roots: profile.roots,
      leaves: flattenBookmarkLeaves(profile.roots),
      sourceLabel: profile.label
    })
    toast.success(`已加载 ${profile.label}`)
  }

  async function onCommit() {
    if (!resolvedMirrorID) {
      toast.error('请选择目标镜像')
      return
    }
    if (!selectedLeaves.length) {
      toast.error('请至少勾选一个文件夹')
      return
    }
    try {
      setBusy(true)
      setProgress({ percent: 0, label: '准备写入书签库…' })
      const result = await commitBookmarkImport({
        mirrorID: resolvedMirrorID,
        roots: preview!.roots,
        selectedFolders,
        strategy,
        onProgress: setProgress
      })
      toast.success(
        `已存入书签库：新增 ${result.inserted}，跳过 ${result.skipped}，覆盖 ${result.updated}`
      )
      props.onImported?.(resolvedMirrorID)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : '导入失败')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className={styles.body}>
      <section className={`${styles.chrome} ${styles.sheetChrome}`}>
        <p className={styles.sheetTitle}>导入书签</p>
        <div className={styles.toolbarGrow}>
          <div className={styles.fieldInline}>
            <span className={styles.fieldLabel}>镜像</span>
            <Select
              items={mirrorItems}
              value={resolvedMirrorID || null}
              onValueChange={function (value) {
                if (value === null) return
                setMirrorID(value)
              }}>
              <SelectTrigger className={styles.fieldControl}>
                <SelectValue placeholder="选择镜像" />
              </SelectTrigger>
              <SelectContent>
                {mirrorItems.map(function (item) {
                  return (
                    <SelectItem
                      key={item.value}
                      value={item.value}>
                      {item.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <div className={styles.fieldInline}>
            <span className={styles.fieldLabel}>重复</span>
            <Select
              items={[...STRATEGY_ITEMS]}
              value={strategy}
              onValueChange={function (value) {
                if (value === 'skip' || value === 'overwrite') setStrategy(value)
              }}>
              <SelectTrigger className={styles.fieldControl}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRATEGY_ITEMS.map(function (item) {
                  return (
                    <SelectItem
                      key={item.value}
                      value={item.value}>
                      {item.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            className={styles.primaryBtn}
            disabled={isBusy}
            onClick={function () {
              void onPickHtml()
            }}>
            选择 HTML
          </Button>
          {preview ? (
            <Button
              size="sm"
              className={styles.primaryBtn}
              disabled={isBusy || !selectedLeaves.length}
              onClick={function () {
                void onCommit()
              }}>
              写入书签库
            </Button>
          ) : null}
          {profiles.map(function (profile) {
            return (
              <button
                key={profile.path}
                type="button"
                className={styles.profileChip}
                disabled={isBusy}
                title={profile.path}
                onClick={function () {
                  onPickProfile(profile)
                }}>
                {profile.label}
              </button>
            )
          })}
        </div>
      </section>

      {preview ? (
        <>
          <p className={styles.metaLine}>
            {preview.sourceLabel} · 书签表 · 已选 {selectedLeaves.length}/{preview.leaves.length}
          </p>
          <BookmarkExplorer
            key={preview.sourceLabel}
            roots={preview.roots}
            selectedFolders={selectedFolders}
            onUpdateSelectedFolders={setSelectedFolders}
            viewMode={viewMode}
            sortKey={sortKey}
            onUpdateViewMode={function (mode) {
              setViewMode(mode)
              writeViewMode(mode)
            }}
            onUpdateSortKey={function (key) {
              setSortKey(key)
              writeSortKey(key)
            }}
          />
          {progress ? (
            <div className={styles.progressBar}>
              <Progress value={progress.percent} />
              <p className="text-[11px] text-muted-foreground">{progress.label}</p>
            </div>
          ) : null}
        </>
      ) : (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <Icon
              icon="lucide:bookmark-plus"
              className="size-5"
            />
          </div>
          <p className={styles.emptyTitle}>导入 Chrome 书签</p>
          <p className={styles.emptyDesc}>
            选择 HTML 导出文件或本机 Profile，按文件夹写入书签库；导入完成后可在书签库中挂到磁贴。
          </p>
        </div>
      )}
    </div>
  )
}

export { BookmarkImportWizard }
