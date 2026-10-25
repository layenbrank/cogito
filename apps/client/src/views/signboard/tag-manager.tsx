import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  TAG_COLORS,
  useSignboardStore,
  type SignboardTag
} from '@/stores/signboard'
import styles from '@/views/signboard/signboard.module.scss'

interface TagManagerProps {
  tags: SignboardTag[]
  boardID: string | null
  /** 紧凑嵌入筛选 Popover */
  compact?: boolean
}

function TagManager(props: TagManagerProps) {
  const toWriteTag = useSignboardStore(function (state) {
    return state.toWriteTag
  })
  const toUpdateTag = useSignboardStore(function (state) {
    return state.toUpdateTag
  })
  const toRemoveTag = useSignboardStore(function (state) {
    return state.toRemoveTag
  })

  const [draft, setDraft] = useState('')
  const [editingID, setEditingID] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [colorTagID, setColorTagID] = useState<string | null>(null)

  async function createTag() {
    const title = draft.trim()
    if (!title || !props.boardID) return
    const existing = props.tags.find(function (tag) {
      return tag.title === title
    })
    if (existing) {
      toast.message('标签已存在')
      setDraft('')
      return
    }
    const id = await toWriteTag(props.boardID, title)
    if (!id) {
      toast.error('新建标签失败')
      return
    }
    setDraft('')
    toast.success('已新建标签')
  }

  async function commitRename(tagID: string) {
    const title = editTitle.trim()
    setEditingID(null)
    if (!title) return
    const current = props.tags.find(function (tag) {
      return tag.id === tagID
    })
    if (!current || current.title === title) return
    const ok = await toUpdateTag(tagID, { title })
    if (!ok) toast.error('重命名失败')
  }

  async function removeTag(tagID: string, title: string) {
    const ok = await toRemoveTag(tagID)
    if (!ok) {
      toast.error('删除标签失败')
      return
    }
    toast.success(`已删除「${title}」`)
    if (editingID === tagID) setEditingID(null)
    if (colorTagID === tagID) setColorTagID(null)
  }

  return (
    <div className={props.compact ? styles.tagManagerCompact : styles.tagManager}>
      <p className={styles.tagManagerHint}>
        管理本看板标签：新建、改名、改色或删除。卡片上可随时挂载。
      </p>

      <ul className={styles.tagManagerList}>
        {props.tags.length === 0 ? (
          <li className={styles.tagManagerEmpty}>还没有标签，先建一个吧</li>
        ) : (
          props.tags.map(function (tag) {
            const isEditing = editingID === tag.id
            const isPicking = colorTagID === tag.id
            return (
              <li
                key={tag.id}
                className={styles.tagManagerRow}>
                <span
                  className={styles.tagManagerSwatch}
                  style={{ background: tag.color ?? 'var(--muted-foreground)' }}
                  aria-hidden
                />
                {isEditing ? (
                  <Input
                    autoFocus
                    value={editTitle}
                    className="h-8 flex-1"
                    onChange={function (event) {
                      setEditTitle(event.target.value)
                    }}
                    onBlur={function () {
                      void commitRename(tag.id)
                    }}
                    onKeyDown={function (event) {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void commitRename(tag.id)
                      }
                      if (event.key === 'Escape') {
                        setEditingID(null)
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={styles.tagManagerTitle}
                    onClick={function () {
                      setEditingID(tag.id)
                      setEditTitle(tag.title)
                      setColorTagID(null)
                    }}>
                    {tag.title}
                  </button>
                )}
                <div className={styles.tagManagerActions}>
                  <button
                    type="button"
                    className={styles.tagManagerIconBtn}
                    aria-label={`调整 ${tag.title} 颜色`}
                    aria-expanded={isPicking}
                    onClick={function () {
                      setColorTagID(function (prev) {
                        return prev === tag.id ? null : tag.id
                      })
                      setEditingID(null)
                    }}>
                    <Icon
                      icon="lucide:palette"
                      className="size-3.5"
                    />
                  </button>
                  <button
                    type="button"
                    className={styles.tagManagerIconBtn}
                    aria-label={`删除 ${tag.title}`}
                    onClick={function () {
                      void removeTag(tag.id, tag.title)
                    }}>
                    <Icon
                      icon="lucide:trash-2"
                      className="size-3.5"
                    />
                  </button>
                </div>
                {isPicking ? (
                  <div
                    className={styles.tagColorRow}
                    role="group"
                    aria-label={`${tag.title} 颜色`}>
                    {TAG_COLORS.map(function (color) {
                      return (
                        <button
                          key={color}
                          type="button"
                          className={styles.tagColorDot}
                          style={{ background: color }}
                          aria-label={`设为 ${color}`}
                          onClick={function () {
                            void toUpdateTag(tag.id, { color }).then(function (ok) {
                              if (!ok) toast.error('改色失败')
                              else setColorTagID(null)
                            })
                          }}
                        />
                      )
                    })}
                  </div>
                ) : null}
              </li>
            )
          })
        )}
      </ul>

      <div className={styles.tagManagerCreate}>
        <Input
          value={draft}
          placeholder="新标签名称"
          className="h-8 flex-1"
          onChange={function (event) {
            setDraft(event.target.value)
          }}
          onKeyDown={function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              void createTag()
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={!draft.trim() || !props.boardID}
          onClick={function () {
            void createTag()
          }}>
          新建
        </Button>
      </div>
    </div>
  )
}

export { TagManager }
