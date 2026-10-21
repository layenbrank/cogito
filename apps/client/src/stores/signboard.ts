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
  toWriteTag: (boardID: string, title: string) => Promise<string | undefined>
  toTagEntry: (entryID: string, tagID: string) => Promise<boolean>
  toUntagEntry: (entryID: string, tagID: string) => Promise<boolean>
  toWriteCheck: (entryID: string, title: string) => Promise<string | undefined>
  toUpdateCheck: (
    key: string,
    change: { title?: string; done?: boolean; index?: number }
  ) => Promise<boolean>
  toRemoveCheck: (key: string) => Promise<boolean>
  toWriteAutomation: (value: AutomationWrite) => Promise<string | undefined>
  toUpdateAutomation: (key: string, change: AutomationChange) => Promise<boolean>
  toRemoveAutomation: (key: string) => Promise<boolean>
  tagIDsForEntry: (entryID: string) => string[]
  entriesInColumn: (columnID: string) => SignboardEntry[]
  checksForEntry: (entryID: string) => SignboardCheck[]
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

        entriesInColumn(columnID) {
          return getter()
            .entries.filter(function (card) {
              return card.columnID === columnID && card.archivedAt == null
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
            console.error('[signboard-store] toReadBoards failed:', error)
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
            if (cardIDs.length > 0) {
              ;[tagged, checks] = await Promise.all([
                invoke<SignboardTagged[]>(CHANNELS.SIGNBOARD_TAGGED.READ, {
                  params: cardIDs.map(function (entryID) {
                    return { entryID }
                  })
                }),
                invoke<SignboardCheck[]>(CHANNELS.SIGNBOARD_CHECK.READ, {
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
                state.automations = automations
                state.loaded = true
              },
              false,
              'toActivateBoard'
            )
          } catch (error) {
            console.error('[signboard-store] toActivateBoard failed:', error)
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
              console.error('[signboard-store] seed failed:', error)
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
              : boards[0]!.id
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
            console.error('[signboard-store] toWriteBoard failed:', error)
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
            console.error('[signboard-store] toUpdateBoard failed:', error)
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
            console.error('[signboard-store] toWriteColumn failed:', error)
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
            console.error('[signboard-store] toUpdateColumn failed:', error)
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
            console.error('[signboard-store] toWriteEntry failed:', error)
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
            if (dueChanged && change.dueAt != null) {
              await runAutomations(getter, {
                trigger: 'entryDueSet',
                entryID: key,
                toColumnID: previous?.columnID,
                tagIDs: getter().tagIDsForEntry(key)
              })
            }
            return true
          } catch (error) {
            console.error('[signboard-store] toUpdateEntry failed:', error)
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
            console.error('[signboard-store] toMoveEntry failed:', error)
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
            console.error('[signboard-store] toRemoveEntry failed:', error)
            return false
          }
        },

        async toWriteTag(boardID, title) {
          try {
            const ids = await invoke<string[]>(CHANNELS.SIGNBOARD_TAG.WRITE, {
              params: { boardID, title, color: null }
            })
            await getter().toActivateBoard(boardID)
            return ids[0]
          } catch (error) {
            console.error('[signboard-store] toWriteTag failed:', error)
            return undefined
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
            console.error('[signboard-store] toTagEntry failed:', error)
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
            console.error('[signboard-store] toUntagEntry failed:', error)
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
            console.error('[signboard-store] toWriteCheck failed:', error)
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
            console.error('[signboard-store] toUpdateCheck failed:', error)
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
            console.error('[signboard-store] toRemoveCheck failed:', error)
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
            console.error('[signboard-store] toWriteAutomation failed:', error)
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
            console.error('[signboard-store] toUpdateAutomation failed:', error)
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
            console.error('[signboard-store] toRemoveAutomation failed:', error)
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
        console.error('[signboard-store] automation attachTag failed:', error)
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
    console.error('[signboard-store] automation card update failed:', error)
  }
}

export { useSignboardStore }
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
  SignboardTagged,
  SignboardCheck,
  SignboardColumn,
  SignboardTag
}
