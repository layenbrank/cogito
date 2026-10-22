import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import {
  applyRules,
  type AutomationAction,
  type AutomationEvent
} from '@/features/signboard/automation'
import { CHANNELS } from '@/shared/ipc/channels'
import { reportCaught } from '@/utils/exception-report'

interface SignboardBoard {
  id: string
  title: string
  index: number
  archivedAt: number | null
  syncedAt: number | null
  createdAt: number
  updatedAt: number
}

interface SignboardColumn {
  id: string
  boardID: string
  title: string
  index: number
  color: string | null
  wipLimit: number | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

interface SignboardEntry {
  id: string
  columnID: string
  title: string
  notes: string
  index: number
  dueAt: number | null
  startAt: number | null
  reminderID: string | null
  priority: number
  color: string | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

interface SignboardTag {
  id: string
  boardID: string
  title: string
  color: string | null
  createdAt: number
  updatedAt: number
}

interface SignboardTagged {
  entryID: string
  tagID: string
}

interface SignboardCheck {
  id: string
  entryID: string
  title: string
  done: boolean
  index: number
  createdAt: number
  updatedAt: number
}

interface SignboardEntryAsset {
  entryID: string
  assetID: string
  index: number
  createdAt: number
}

/** Soft palette — Trello-style scannable color labels without neon glow. */
const TAG_COLORS = [
  '#6B8F71',
  '#C47B5B',
  '#5B7C99',
  '#B08D57',
  '#8B6F9E',
  '#6A8E9F',
  '#9A6B6B',
  '#5F8A7B'
] as const

function pickTagColor(existing: SignboardTag[]): string {
  const used = new Set(
    existing
      .map(function (tag) {
        return tag.color
      })
      .filter(Boolean)
  )
  const free = TAG_COLORS.find(function (color) {
    return !used.has(color)
  })
  return free ?? TAG_COLORS[existing.length % TAG_COLORS.length]
}

interface SignboardAutomation {
  id: string
  boardID: string
  title: string
  enabled: boolean
  trigger: string
  conditionJson: string
  actionJson: string
  index: number
  createdAt: number
  updatedAt: number
}

interface EntryWrite {
  columnID: string
  title: string
  notes?: string
  index?: number
  dueAt?: number | null
  startAt?: number | null
  reminderID?: string | null
  priority?: number
  color?: string | null
}

interface EntryChange {
  columnID?: string
  title?: string
  notes?: string
  index?: number
  dueAt?: number | null
  startAt?: number | null
  reminderID?: string | null
  priority?: number
  color?: string | null
  archivedAt?: number | null
}

interface BoardChange {
  title?: string
  index?: number
  archivedAt?: number | null
}

interface ColumnChange {
  title?: string
  index?: number
  color?: string | null
  wipLimit?: number | null
  archivedAt?: number | null
}

interface AutomationWrite {
  boardID: string
  title: string
  enabled?: boolean
  trigger: string
  conditionJson?: string
  actionJson?: string
  index?: number
}

interface AutomationChange {
  title?: string
  enabled?: boolean
  trigger?: string
  conditionJson?: string
  actionJson?: string
  index?: number
}

interface SignboardStore {
  boards: SignboardBoard[]
  columns: SignboardColumn[]
  entries: SignboardEntry[]
  tags: SignboardTag[]
  tagged: SignboardTagged[]
  checks: SignboardCheck[]
  entryAssets: SignboardEntryAsset[]
  automations: SignboardAutomation[]
  activeBoardID: string | null
  loaded: boolean
  toBootstrap: () => Promise<void>
  toReadBoards: () => Promise<SignboardBoard[]>
  toActivateBoard: (boardID: string) => Promise<void>
  toWriteBoard: (title: string) => Promise<string | undefined>
  toUpdateBoard: (key: string, change: BoardChange) => Promise<boolean>
  toWriteColumn: (boardID: string, title: string) => Promise<string | undefined>
  toUpdateColumn: (key: string, change: ColumnChange) => Promise<boolean>
  toWriteEntry: (value: EntryWrite) => Promise<string | undefined>
  toUpdateEntry: (key: string, change: EntryChange) => Promise<boolean>
  toMoveEntry: (entryID: string, toColumnID: string, toIndex: number) => Promise<boolean>
  toRemoveEntry: (key: string) => Promise<boolean>
  toWriteTag: (
    boardID: string,
    title: string,
    color?: string | null
  ) => Promise<string | undefined>
  toUpdateTag: (
    key: string,
    change: { title?: string; color?: string | null }
  ) => Promise<boolean>
  toTagEntry: (entryID: string, tagID: string) => Promise<boolean>
  toUntagEntry: (entryID: string, tagID: string) => Promise<boolean>
  toWriteCheck: (entryID: string, title: string) => Promise<string | undefined>
  toUpdateCheck: (
    key: string,
    change: { title?: string; done?: boolean; index?: number }
  ) => Promise<boolean>
  toRemoveCheck: (key: string) => Promise<boolean>
  toAttachAsset: (entryID: string, assetID: string) => Promise<boolean>
  toDetachAsset: (entryID: string, assetID: string) => Promise<boolean>
  toPromoteCover: (entryID: string, assetID: string) => Promise<boolean>
  toWriteAutomation: (value: AutomationWrite) => Promise<string | undefined>
  toUpdateAutomation: (key: string, change: AutomationChange) => Promise<boolean>
  toRemoveAutomation: (key: string) => Promise<boolean>
  tagIDsForEntry: (entryID: string) => string[]
  entriesInColumn: (columnID: string) => SignboardEntry[]
  checksForEntry: (entryID: string) => SignboardCheck[]
  assetsForEntry: (entryID: string) => SignboardEntryAsset[]
  coverAssetID: (entryID: string) => string | null
}

const SEED_COLUMNS = ['待办', '进行中', '完成'] as const

const useSignboardStore = create<SignboardStore>()(
  devtools(
    immer(function (setter, getter) {
      return {
        boards: [],
        columns: [],
        entries: [],
        tags: [],
        tagged: [],
        checks: [],
        entryAssets: [],
        automations: [],
        activeBoardID: null,
        loaded: false,

        tagIDsForEntry(entryID) {
          return getter()
            .tagged.filter(function (row) {
              return row.entryID === entryID
            })
            .map(function (row) {
              return row.tagID
            })
        },

        checksForEntry(entryID) {
          return getter()
            .checks.filter(function (item) {
              return item.entryID === entryID
            })
            .slice()
            .sort(function (a, b) {
              return a.index - b.index
            })
        },

        assetsForEntry(entryID) {
          return getter()
            .entryAssets.filter(function (row) {
              return row.entryID === entryID
            })
            .slice()
            .sort(function (a, b) {
              return a.index - b.index
            })
        },

        coverAssetID(entryID) {
          const first = getter().assetsForEntry(entryID)[0]
          return first?.assetID ?? null
        },

        entriesInColumn(columnID) {
          return getter()
            .entries.filter(function (card) {
              return card.columnID === columnID && card.archivedAt === null
            })
            .slice()
            .sort(function (a, b) {
              return a.index - b.index
            })
        },

        async toReadBoards() {
          try {
            const boards = await invoke<SignboardBoard[]>(CHANNELS.SIGNBOARD.READ, {
              params: {}
            })
            setter(
              function (state) {
                state.boards = boards
              },
              false,
              'toReadBoards'
            )
            return boards
          } catch (error) {
            reportCaught('signboard-store.toReadBoards', error)
            return []
          }
        },

        async toActivateBoard(boardID) {
          try {
            const [columns, tags, automations] = await Promise.all([
              invoke<SignboardColumn[]>(CHANNELS.SIGNBOARD_COLUMN.READ, {
                params: { boardID }
              }),
              invoke<SignboardTag[]>(CHANNELS.SIGNBOARD_TAG.READ, {
                params: { boardID }
              }),
              invoke<SignboardAutomation[]>(CHANNELS.SIGNBOARD_AUTOMATION.READ, {
                params: { boardID }
              })
            ])

            const columnIDs = columns.map(function (column) {
              return column.id
            })
            let entries: SignboardEntry[] = []
            if (columnIDs.length > 0) {
              entries = await invoke<SignboardEntry[]>(CHANNELS.SIGNBOARD_ENTRY.READ, {
                params: columnIDs.map(function (columnID) {
                  return { columnID }
                })
              })
            }

            const cardIDs = entries.map(function (card) {
              return card.id
            })
            let tagged: SignboardTagged[] = []
            let checks: SignboardCheck[] = []
            let entryAssets: SignboardEntryAsset[] = []
            if (cardIDs.length > 0) {
              ;[tagged, checks, entryAssets] = await Promise.all([
                invoke<SignboardTagged[]>(CHANNELS.SIGNBOARD_TAGGED.READ, {
                  params: cardIDs.map(function (entryID) {
                    return { entryID }
                  })
                }),
                invoke<SignboardCheck[]>(CHANNELS.SIGNBOARD_CHECK.READ, {
                  params: cardIDs.map(function (entryID) {
                    return { entryID }
                  })
                }),
                invoke<SignboardEntryAsset[]>(CHANNELS.SIGNBOARD_ENTRY_ASSET.READ, {
                  params: cardIDs.map(function (entryID) {
                    return { entryID }
                  })
                })
              ])
            }

            setter(
              function (state) {
                state.activeBoardID = boardID
                state.columns = columns
                state.entries = entries
                state.tags = tags
                state.tagged = tagged
                state.checks = checks
                state.entryAssets = entryAssets
                state.automations = automations
                state.loaded = true
              },
              false,
              'toActivateBoard'
            )
          } catch (error) {
            reportCaught('signboard-store.toActivateBoard', error)
            setter(
              function (state) {
                state.loaded = true
              },
              false,
              'toActivateBoard/error'
            )
          }
        },

        async toBootstrap() {
          const boards = await getter().toReadBoards()
          if (boards.length === 0) {
            try {
              const boardIDs = await invoke<string[]>(CHANNELS.SIGNBOARD.WRITE, {
                params: { title: '个人', index: 0 }
              })
              const boardID = boardIDs[0]
              if (!boardID) return
              await invoke<string[]>(CHANNELS.SIGNBOARD_COLUMN.WRITE, {
                params: SEED_COLUMNS.map(function (title, index) {
                  return {
                    boardID,
                    title,
                    index,
                    color: null,
                    wipLimit: null
                  }
                })
              })
              await getter().toReadBoards()
              await getter().toActivateBoard(boardID)
              return
            } catch (error) {
              reportCaught('signboard-store.seed', error)
              setter(
                function (state) {
                  state.loaded = true
                },
                false,
                'toBootstrap/seed-error'
              )
              return
            }
          }

          const active =
            getter().activeBoardID &&
            boards.some(function (board) {
              return board.id === getter().activeBoardID
            })
              ? getter().activeBoardID!
              : boards[0].id
          await getter().toActivateBoard(active)
        },

        async toWriteBoard(title) {
          try {
            const ids = await invoke<string[]>(CHANNELS.SIGNBOARD.WRITE, {
              params: { title, index: getter().boards.length }
            })
            await getter().toReadBoards()
            const id = ids[0]
            if (id) await getter().toActivateBoard(id)
            return id
          } catch (error) {
            reportCaught('signboard-store.toWriteBoard', error)
            return undefined
          }
        },

        async toUpdateBoard(key, change) {
          try {
            await invoke(CHANNELS.SIGNBOARD.UPDATE, {
              params: { key, change }
            })
            await getter().toReadBoards()
            return true
          } catch (error) {
            reportCaught('signboard-store.toUpdateBoard', error)
            return false
          }
        },

        async toWriteColumn(boardID, title) {
          try {
            const index = getter().columns.filter(function (column) {
              return column.boardID === boardID
            }).length
            const ids = await invoke<string[]>(CHANNELS.SIGNBOARD_COLUMN.WRITE, {
              params: { boardID, title, index, color: null, wipLimit: null }
            })
            await getter().toActivateBoard(boardID)
            return ids[0]
          } catch (error) {
            reportCaught('signboard-store.toWriteColumn', error)
            return undefined
          }
        },

        async toUpdateColumn(key, change) {
          try {
            await invoke(CHANNELS.SIGNBOARD_COLUMN.UPDATE, {
              params: { key, change }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            reportCaught('signboard-store.toUpdateColumn', error)
            return false
          }
        },

        async toWriteEntry(value) {
          try {
            const index =
              value.index ?? getter().entriesInColumn(value.columnID).length
            const ids = await invoke<string[]>(CHANNELS.SIGNBOARD_ENTRY.WRITE, {
              params: {
                columnID: value.columnID,
                title: value.title,
                notes: value.notes ?? '',
                index,
                dueAt: value.dueAt ?? null,
                startAt: value.startAt ?? null,
                reminderID: value.reminderID ?? null,
                priority: value.priority ?? 0,
                color: value.color ?? null
              }
            })
            const entryID = ids[0]
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            if (entryID) {
              await runAutomations(getter, {
                trigger: 'entryCreated',
                entryID,
                toColumnID: value.columnID,
                tagIDs: []
              })
            }
            return entryID
          } catch (error) {
            reportCaught('signboard-store.toWriteEntry', error)
            return undefined
          }
        },

        async toUpdateEntry(key, change) {
          try {
            const previous = getter().entries.find(function (card) {
              return card.id === key
            })
            const dueChanged =
              change.dueAt !== undefined && change.dueAt !== previous?.dueAt
            await invoke(CHANNELS.SIGNBOARD_ENTRY.UPDATE, {
              params: { key, change }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            if (dueChanged && change.dueAt !== null && change.dueAt !== undefined) {
              await runAutomations(getter, {
                trigger: 'entryDueSet',
                entryID: key,
                toColumnID: previous?.columnID,
                tagIDs: getter().tagIDsForEntry(key)
              })
            }
            return true
          } catch (error) {
            reportCaught('signboard-store.toUpdateEntry', error)
            return false
          }
        },

        async toMoveEntry(entryID, toColumnID, toIndex) {
          const previous = {
            entries: getter().entries.map(function (card) {
              return { ...card }
            })
          }
          const moving = getter().entries.find(function (card) {
            return card.id === entryID
          })
          if (!moving) return false

          const fromColumnID = moving.columnID
          setter(
            function (state) {
              const others = state.entries.filter(function (card) {
                return card.id !== entryID
              })
              const dest = others
                .filter(function (card) {
                  return card.columnID === toColumnID
                })
                .sort(function (a, b) {
                  return a.index - b.index
                })
              const clamped = Math.max(0, Math.min(toIndex, dest.length))
              dest.splice(clamped, 0, { ...moving, columnID: toColumnID })

              const reindexed = new Map<string, SignboardEntry>()
              dest.forEach(function (card, index) {
                reindexed.set(card.id, { ...card, columnID: toColumnID, index })
              })

              if (fromColumnID !== toColumnID) {
                others
                  .filter(function (card) {
                    return card.columnID === fromColumnID
                  })
                  .sort(function (a, b) {
                    return a.index - b.index
                  })
                  .forEach(function (card, index) {
                    reindexed.set(card.id, { ...card, index })
                  })
              }

              state.entries = state.entries.map(function (card) {
                return reindexed.get(card.id) ?? card
              })
            },
            false,
            'toMoveEntry/optimistic'
          )

          try {
            const updates = getter()
              .entries.filter(function (card) {
                if (card.id === entryID) return true
                if (card.columnID === toColumnID) return true
                if (card.columnID === fromColumnID) return true
                return false
              })
              .map(function (card) {
                return {
                  key: card.id,
                  change: {
                    columnID: card.columnID,
                    index: card.index
                  }
                }
              })

            await invoke(CHANNELS.SIGNBOARD_ENTRY.UPDATE, {
              params: updates.length === 1 ? updates[0] : updates
            })

            if (fromColumnID !== toColumnID) {
              const tagIDs = getter().tagIDsForEntry(entryID)
              await runAutomations(getter, {
                trigger: 'entryLeaveColumn',
                entryID,
                fromColumnID,
                toColumnID,
                tagIDs
              })
              await runAutomations(getter, {
                trigger: 'entryEnterColumn',
                entryID,
                fromColumnID,
                toColumnID,
                tagIDs
              })
            }
            return true
          } catch (error) {
            reportCaught('signboard-store.toMoveEntry', error)
            setter(
              function (state) {
                state.entries = previous.entries
              },
              false,
              'toMoveEntry/rollback'
            )
            return false
          }
        },

        async toRemoveEntry(key) {
          try {
            await invoke(CHANNELS.SIGNBOARD_ENTRY.REMOVE, { params: key })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            reportCaught('signboard-store.toRemoveEntry', error)
            return false
          }
        },

        async toWriteTag(boardID, title, color) {
          try {
            const nextColor =
              color === undefined
                ? pickTagColor(
                    getter().tags.filter(function (tag) {
                      return tag.boardID === boardID
                    })
                  )
                : color
            const ids = await invoke<string[]>(CHANNELS.SIGNBOARD_TAG.WRITE, {
              params: { boardID, title, color: nextColor }
            })
            await getter().toActivateBoard(boardID)
            return ids[0]
          } catch (error) {
            reportCaught('signboard-store.toWriteTag', error)
            return undefined
          }
        },

        async toUpdateTag(key, change) {
          try {
            await invoke(CHANNELS.SIGNBOARD_TAG.UPDATE, {
              params: { key, change }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            console.error('[signboard-store] toUpdateTag failed:', error)
            return false
          }
        },

        async toTagEntry(entryID, tagID) {
          try {
            await invoke(CHANNELS.SIGNBOARD_TAGGED.WRITE, {
              params: { entryID, tagID }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            reportCaught('signboard-store.toTagEntry', error)
            return false
          }
        },

        async toUntagEntry(entryID, tagID) {
          try {
            await invoke(CHANNELS.SIGNBOARD_TAGGED.REMOVE, {
              params: { entryID, tagID }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            reportCaught('signboard-store.toUntagEntry', error)
            return false
          }
        },

        async toWriteCheck(entryID, title) {
          try {
            const index = getter().checksForEntry(entryID).length
            const ids = await invoke<string[]>(CHANNELS.SIGNBOARD_CHECK.WRITE, {
              params: { entryID, title, done: false, index }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return ids[0]
          } catch (error) {
            reportCaught('signboard-store.toWriteCheck', error)
            return undefined
          }
        },

        async toUpdateCheck(key, change) {
          try {
            await invoke(CHANNELS.SIGNBOARD_CHECK.UPDATE, {
              params: { key, change }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            reportCaught('signboard-store.toUpdateCheck', error)
            return false
          }
        },

        async toRemoveCheck(key) {
          try {
            await invoke(CHANNELS.SIGNBOARD_CHECK.REMOVE, { params: key })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            reportCaught('signboard-store.toRemoveCheck', error)
            return false
          }
        },

        async toAttachAsset(entryID, assetID) {
          try {
            await invoke(CHANNELS.SIGNBOARD_ENTRY_ASSET.WRITE, {
              params: { entryID, assetID }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            console.error('[signboard-store] toAttachAsset failed:', error)
            return false
          }
        },

        async toDetachAsset(entryID, assetID) {
          try {
            await invoke(CHANNELS.SIGNBOARD_ENTRY_ASSET.REMOVE, {
              params: { entryID, assetID }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            console.error('[signboard-store] toDetachAsset failed:', error)
            return false
          }
        },

        async toPromoteCover(entryID, assetID) {
          const rows = getter().assetsForEntry(entryID)
          if (rows.length === 0) return false
          const reordered = [
            ...rows.filter(function (row) {
              return row.assetID === assetID
            }),
            ...rows.filter(function (row) {
              return row.assetID !== assetID
            })
          ]
          try {
            await invoke(CHANNELS.SIGNBOARD_ENTRY_ASSET.UPDATE, {
              params: reordered.map(function (row, index) {
                return {
                  entryID,
                  assetID: row.assetID,
                  change: { index }
                }
              })
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            console.error('[signboard-store] toPromoteCover failed:', error)
            return false
          }
        },

        async toWriteAutomation(value) {
          try {
            const index =
              value.index ??
              getter().automations.filter(function (row) {
                return row.boardID === value.boardID
              }).length
            const ids = await invoke<string[]>(CHANNELS.SIGNBOARD_AUTOMATION.WRITE, {
              params: {
                boardID: value.boardID,
                title: value.title,
                enabled: value.enabled ?? true,
                trigger: value.trigger,
                conditionJson: value.conditionJson ?? '{}',
                actionJson: value.actionJson ?? '[]',
                index
              }
            })
            await getter().toActivateBoard(value.boardID)
            return ids[0]
          } catch (error) {
            reportCaught('signboard-store.toWriteAutomation', error)
            return undefined
          }
        },

        async toUpdateAutomation(key, change) {
          try {
            await invoke(CHANNELS.SIGNBOARD_AUTOMATION.UPDATE, {
              params: { key, change }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            reportCaught('signboard-store.toUpdateAutomation', error)
            return false
          }
        },

        async toRemoveAutomation(key) {
          try {
            await invoke(CHANNELS.SIGNBOARD_AUTOMATION.REMOVE, { params: key })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            reportCaught('signboard-store.toRemoveAutomation', error)
            return false
          }
        }
      }
    }),
    { name: 'signboard-store' }
  )
)

const AUTOMATION_DEPTH = { value: 0 }

async function runAutomations(
  getter: () => SignboardStore,
  event: AutomationEvent
) {
  if (AUTOMATION_DEPTH.value >= 3) return
  AUTOMATION_DEPTH.value += 1
  try {
    const matched = applyRules(event, getter().automations)
    for (const row of matched) {
      for (const action of row.actions) {
        await applyAction(getter, event.entryID, action)
      }
    }
  } finally {
    AUTOMATION_DEPTH.value -= 1
  }
}

async function applyAction(
  getter: () => SignboardStore,
  entryID: string,
  action: AutomationAction
) {
  switch (action.type) {
    case 'setPriority':
      await persistCardChange(getter, entryID, { priority: action.priority })
      return
    case 'setDueOffsetDays': {
      const dueAt = Date.now() + action.days * 24 * 60 * 60 * 1000
      await persistCardChange(getter, entryID, { dueAt })
      return
    }
    case 'attachTag':
      try {
        await invoke(CHANNELS.SIGNBOARD_TAGGED.WRITE, {
          params: { entryID, tagID: action.tagID }
        })
        const boardID = getter().activeBoardID
        if (boardID) await getter().toActivateBoard(boardID)
      } catch (error) {
        reportCaught('signboard-store.automationAttachTag', error)
      }
      return
    case 'archiveCard':
      await persistCardChange(getter, entryID, { archivedAt: Date.now() })
      return
    case 'setColor':
      await persistCardChange(getter, entryID, { color: action.color })
      return
  }
}

/** 自动化写卡：不二次触发规则，避免同 trigger 递归。 */
async function persistCardChange(
  getter: () => SignboardStore,
  key: string,
  change: EntryChange
) {
  try {
    await invoke(CHANNELS.SIGNBOARD_ENTRY.UPDATE, {
      params: { key, change }
    })
    const boardID = getter().activeBoardID
    if (boardID) await getter().toActivateBoard(boardID)
  } catch (error) {
    reportCaught('signboard-store.automationCardUpdate', error)
  }
}

export { TAG_COLORS, useSignboardStore }
export type {
  AutomationChange,
  AutomationWrite,
  BoardChange,
  EntryChange,
  EntryWrite,
  ColumnChange,
  SignboardAutomation,
  SignboardBoard,
  SignboardEntry,
  SignboardEntryAsset,
  SignboardTagged,
  SignboardCheck,
  SignboardColumn,
  SignboardTag
}
