/**
 * 书签导入向导（Dialog 内）：
 * 选镜像 / 重复策略 → 选来源 → 勾文件夹 → 写入。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { Progress } from '@cogito/design/components/progress'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'

import { useMirrorStore } from '@/stores/mirror'
import styles from '@/views/bookmark/bookmark.module.scss'
import { ImportFolderTree } from '@/views/bookmark/import-folder-tree'
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

interface WizardProps {
  onImported?: (mirrorID: string) => void
}

const STRATEGY_ITEMS = [
  { value: 'skip', label: '跳过' },
  { value: 'overwrite', label: '覆盖' }
] as const

function findSourceName(label: string) {
  const normalized = label.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  return slash < 0 ? label : normalized.slice(slash + 1)
}

function BookmarkImportWizard(props: WizardProps) {
  const { mirrors, activeMirrorID } = useMirrorStore(
    useShallow(function (state) {
      return {
        mirrors: state.mirrors,
        activeMirrorID: state.active.mirror?.id ?? null
      }
    })
  )

  const [mirrorID, setMirrorID] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [selectedFolders, setSelectedFolders] = useState<string[]>([])
  const [strategy, setStrategy] = useState<DuplicateStrategy>('skip')
  const [profiles, setProfiles] = useState<ChromeProfileBookmarks[]>([])
  const [isBusy, setBusy] = useState(false)
  const [progress, setProgress] = useState<CommitProgress | null>(null)

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

  const activeMirrorTitle = useMemo(
    function () {
      const hit = mirrors.find(function (mirror) {
        return mirror.id === resolvedMirrorID
      })
      return hit?.title ?? '选择镜像'
    },
    [mirrors, resolvedMirrorID]
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

  function writePreview(next: ImportPreview) {
    setPreview(next)
    setSelectedFolders(findDefaultSelectedFolders(next.roots))
  }

  async function onPickHtml() {
    try {
      setBusy(true)
      const next = await previewFromHtmlFile()
      if (!next) return
      writePreview(next)
      toast.success(`已解析 ${next.leaves.length} 条链接`)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : '解析 HTML 失败')
    } finally {
      setBusy(false)
    }
  }

  function onPickProfile(profile: ChromeProfileBookmarks) {
    writePreview({
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
    <div className={styles.importBody}>
      <DialogHeader className={styles.importHeader}>
        <DialogTitle>导入书签</DialogTitle>
        <DialogDescription>写入书签库后，可在主库勾选并挂到磁贴墙。</DialogDescription>
      </DialogHeader>

      <div className={styles.importSettings}>
        <label className={styles.importField}>
          <span className={styles.importFieldLabel}>目标镜像</span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={styles.importMirrorTrigger}
                />
              }>
              <span className="min-w-0 flex-1 truncate text-left">{activeMirrorTitle}</span>
              <Icon
                icon="lucide:chevron-down"
                className="text-muted-foreground size-3.5 shrink-0 opacity-70"
                aria-hidden
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={6}
              className={styles.importMirrorMenu}>
              {mirrors.map(function (mirror) {
                const isActive = mirror.id === resolvedMirrorID
                return (
                  <DropdownMenuItem
                    key={mirror.id}
                    className={isActive ? styles.importMirrorItemActive : undefined}
                    onClick={function () {
                      setMirrorID(mirror.id)
                    }}>
                    {mirror.title}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </label>

        <div className={styles.importField}>
          <span className={styles.importFieldLabel}>重复链接</span>
          <ToggleGroup
            spacing={0}
            size="sm"
            value={[strategy]}
            onValueChange={function (value) {
              const next = value[0]
              if (next === 'skip' || next === 'overwrite') setStrategy(next)
            }}
            className={styles.importStrategy}>
            {STRATEGY_ITEMS.map(function (item) {
              return (
                <ToggleGroupItem
                  key={item.value}
                  value={item.value}
                  className={styles.importStrategyItem}>
                  {item.label}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </div>
      </div>

      {preview ? (
        <div className={styles.importPreview}>
          <div className={styles.importSourceBar}>
            <div
              className={styles.importSourceMeta}
              title={preview.sourceLabel}>
              <Icon
                icon="lucide:file-text"
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
              <span className={styles.importSourcePath}>
                {findSourceName(preview.sourceLabel)}
              </span>
              <span className={styles.importSourceCount}>
                {selectedLeaves.length}/{preview.leaves.length}
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={styles.importSourceReset}
              disabled={isBusy}
              onClick={function () {
                setPreview(null)
                setSelectedFolders([])
              }}>
              重选
            </Button>
          </div>

          <ImportFolderTree
            roots={preview.roots}
            selectedFolders={selectedFolders}
            onUpdateSelectedFolders={setSelectedFolders}
          />

          {progress ? (
            <div className={styles.progressBar}>
              <Progress value={progress.percent} />
              <p className="text-muted-foreground text-xs">{progress.label}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.importSources}>
          <button
            type="button"
            className={styles.importSourceCard}
            disabled={isBusy}
            onClick={function () {
              void onPickHtml()
            }}>
            <span className={styles.importSourceIcon}>
              <Icon
                icon="lucide:file-code-2"
                className="size-4.5"
                aria-hidden
              />
            </span>
            <span className={styles.importSourceCopy}>
              <span className={styles.importSourceTitle}>从 HTML 导入</span>
              <span className={styles.importSourceDesc}>Chrome / Edge 导出的书签文件</span>
            </span>
            <Icon
              icon="lucide:chevron-right"
              className="text-muted-foreground size-4 shrink-0 opacity-50"
              aria-hidden
            />
          </button>

          {profiles.length ? (
            <div className={styles.importProfileBlock}>
              <p className={styles.importFieldLabel}>本机 Profile</p>
              <div className={styles.importProfileChips}>
                {profiles.map(function (profile) {
                  return (
                    <Button
                      key={profile.path}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={styles.profileChip}
                      disabled={isBusy}
                      title={profile.path}
                      onClick={function () {
                        onPickProfile(profile)
                      }}>
                      {profile.label}
                    </Button>
                  )
                })}
              </div>
            </div>
          ) : (
            <p className={styles.importSourceHint}>未检测到本机 Profile 时，请使用 HTML 文件。</p>
          )}
        </div>
      )}

      <DialogFooter className={`${styles.importFooter} sm:justify-between`}>
        <p className={styles.importFooterHint}>
          {preview ? `将写入 ${selectedLeaves.length} 条链接` : '选择来源后开始导入'}
        </p>
        {preview ? (
          <Button
            size="sm"
            disabled={isBusy || !selectedLeaves.length || !resolvedMirrorID}
            onClick={function () {
              void onCommit()
            }}>
            {isBusy ? '写入中…' : '写入书签库'}
          </Button>
        ) : null}
      </DialogFooter>
    </div>
  )
}

export { BookmarkImportWizard }
