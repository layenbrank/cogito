import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { Input } from '@cogito/design/components/input'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@cogito/design/components/popover'
import { useState, type MouseEvent, type ReactElement } from 'react'
import { toast } from 'sonner'

import {
  useSignboardStore,
  type SignboardCheck,
  type SignboardEntry
} from '@/stores/signboard'
import styles from '@/views/signboard/signboard.module.scss'

interface CardQuickPanelProps {
  card: SignboardEntry
  checklist: SignboardCheck[]
  /** 默认 tags：卡片上的 +；checks：清单快捷入口 */
  focus?: 'tags' | 'checks'
  /** 自定义触发器（如清单徽章） */
  trigger?: ReactElement
}

function stop(event: MouseEvent) {
  event.stopPropagation()
  event.preventDefault()
}

function CardQuickPanel(props: CardQuickPanelProps) {
  const focus = props.focus ?? 'tags'
  const activeBoardID = useSignboardStore(function (state) {
    return state.activeBoardID
  })
  const boardTags = useSignboardStore(function (state) {
    return state.tags
  })
  const tagIDsForEntry = useSignboardStore(function (state) {
    return state.tagIDsForEntry
  })
  const toTagEntry = useSignboardStore(function (state) {
    return state.toTagEntry
  })
  const toUntagEntry = useSignboardStore(function (state) {
    return state.toUntagEntry
  })
  const toWriteTag = useSignboardStore(function (state) {
    return state.toWriteTag
  })
  const toWriteCheck = useSignboardStore(function (state) {
    return state.toWriteCheck
  })
  const toUpdateCheck = useSignboardStore(function (state) {
    return state.toUpdateCheck
  })

  const [tagDraft, setTagDraft] = useState('')
  const [checkDraft, setCheckDraft] = useState('')
  const [tab, setTab] = useState<'tags' | 'checks'>(focus)
  const attached = tagIDsForEntry(props.card.id)
  const checkTotal = props.checklist.length
  const checkDone = props.checklist.filter(function (item) {
    return item.done
  }).length
  const checkPct =
    checkTotal === 0 ? 0 : Math.round((checkDone / checkTotal) * 100)

  async function toggleTag(tagID: string) {
    const isOn = attached.includes(tagID)
    const ok = isOn
      ? await toUntagEntry(props.card.id, tagID)
      : await toTagEntry(props.card.id, tagID)
    if (!ok) toast.error(isOn ? '移除标签失败' : '添加标签失败')
  }

  async function createTag() {
    const title = tagDraft.trim()
    if (!title || !activeBoardID) return
    const existing = boardTags.find(function (tag) {
      return tag.title === title
    })
    if (existing) {
      setTagDraft('')
      const ok = await toTagEntry(props.card.id, existing.id)
      if (!ok) toast.error('绑定标签失败')
      return
    }
    const id = await toWriteTag(activeBoardID, title)
    if (!id) {
      toast.error('新建标签失败')
      return
    }
    setTagDraft('')
    const ok = await toTagEntry(props.card.id, id)
    if (!ok) toast.error('绑定标签失败')
  }

  async function addCheck() {
    const title = checkDraft.trim()
    if (!title) return
    const id = await toWriteCheck(props.card.id, title)
    if (!id) {
      toast.error('添加清单失败')
      return
    }
    setCheckDraft('')
  }

  return (
    <Popover
      onOpenChange={function (open) {
        if (open) setTab(focus)
      }}>
      <PopoverTrigger
        render={
          props.trigger ?? (
            <button
              type="button"
              className={styles.quickTrigger}
              aria-label={focus === 'tags' ? '编辑标签' : '编辑清单'}
              onClick={stop}
              onPointerDown={stop}
            />
          )
        }>
        {props.trigger ? null : (
          <Icon
            icon={focus === 'tags' ? 'lucide:plus' : 'lucide:list-checks'}
            className="size-3"
            aria-hidden
          />
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className={styles.quickPanel}
        onClick={stop}
        onPointerDown={stop}>
        <PopoverHeader className={styles.quickHeader}>
          <PopoverTitle>快捷编辑</PopoverTitle>
          <div className={styles.quickTabs}>
            <button
              type="button"
              className={tab === 'tags' ? styles.quickTabOn : styles.quickTab}
              onClick={function () {
                setTab('tags')
              }}>
              标签
            </button>
            <button
              type="button"
              className={tab === 'checks' ? styles.quickTabOn : styles.quickTab}
              onClick={function () {
                setTab('checks')
              }}>
              清单
            </button>
          </div>
        </PopoverHeader>

        {tab === 'tags' ? (
          <div className={styles.quickSection}>
            {boardTags.length === 0 ? (
              <p className={styles.tagManagerEmpty}>还没有标签，输入名称即可新建并挂上</p>
            ) : (
              <div className={styles.quickTagList}>
                {boardTags.map(function (tag) {
                  const isOn = attached.includes(tag.id)
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className={isOn ? styles.quickTagOn : styles.quickTag}
                      style={
                        tag.color
                          ? {
                              background: isOn
                                ? `color-mix(in oklab, ${tag.color} 22%, var(--card))`
                                : undefined,
                              color: tag.color ?? undefined,
                              borderColor: isOn
                                ? tag.color
                                : `color-mix(in oklab, ${tag.color} 30%, transparent)`
                            }
                          : undefined
                      }
                      onClick={function () {
                        void toggleTag(tag.id)
                      }}>
                      <span
                        className={styles.filterSwatch}
                        style={{
                          background: tag.color ?? 'var(--muted-foreground)'
                        }}
                        aria-hidden
                      />
                      {tag.title}
                      {isOn ? (
                        <Icon
                          icon="lucide:check"
                          className="size-3 opacity-80"
                        />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
            <div className={styles.quickRow}>
              <Input
                value={tagDraft}
                placeholder="搜索或新建标签"
                className="h-8 flex-1"
                onChange={function (event) {
                  setTagDraft(event.target.value)
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
                disabled={!tagDraft.trim()}
                onClick={function () {
                  void createTag()
                }}>
                添加
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.quickSection}>
            <div className={styles.quickProgress}>
              <span>
                {checkTotal > 0
                  ? `${checkDone}/${checkTotal} · ${checkPct}%`
                  : '暂无步骤'}
              </span>
              <div
                className={styles.quickProgressTrack}
                role="progressbar"
                aria-valuenow={checkPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="清单进度">
                <div
                  className={styles.quickProgressFill}
                  style={{ width: `${checkPct}%` }}
                />
              </div>
            </div>
            <ul className={styles.quickCheckList}>
              {props.checklist.length === 0 ? (
                <li className={styles.tagManagerEmpty}>暂无清单项</li>
              ) : (
                props.checklist.map(function (item) {
                  return (
                    <li
                      key={item.id}
                      className={styles.quickCheckItem}>
                      <Checkbox
                        checked={item.done}
                        onCheckedChange={function (checked) {
                          void toUpdateCheck(item.id, { done: Boolean(checked) })
                        }}
                      />
                      <span
                        className={
                          item.done ? styles.quickCheckDone : undefined
                        }>
                        {item.title}
                      </span>
                    </li>
                  )
                })
              )}
            </ul>
            <div className={styles.quickRow}>
              <Input
                value={checkDraft}
                placeholder="添加一步"
                className="h-8 flex-1"
                onChange={function (event) {
                  setCheckDraft(event.target.value)
                }}
                onKeyDown={function (event) {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void addCheck()
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                className="h-8"
                disabled={!checkDraft.trim()}
                onClick={function () {
                  void addCheck()
                }}>
                添加
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export { CardQuickPanel }
