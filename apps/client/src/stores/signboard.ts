import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

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

interface SignboardCard {
  id: string
  columnID: string
  title: string
  notes: string
  index: number
  dueAt: number | null
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

interface SignboardCardTag {
  cardID: string
  tagID: string
}

interface CardWrite {
  columnID: string
  title: string
  notes?: string
  index?: number
  dueAt?: number | null
  reminderID?: string | null
  priority?: number
  color?: string | null
}

interface CardChange {
  columnID?: string
  title?: string
  notes?: string
  index?: number
  dueAt?: number | null
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

interface SignboardStore {
  boards: SignboardBoard[]
  columns: SignboardColumn[]
  cards: SignboardCard[]
  tags: SignboardTag[]
  cardTags: SignboardCardTag[]
  activeBoardID: string | null
  loaded: boolean
  toBootstrap: () => Promise<void>
  toReadBoards: () => Promise<SignboardBoard[]>
  toActivateBoard: (boardID: string) => Promise<void>
  toWriteBoard: (title: string) => Promise<string | undefined>
  toUpdateBoard: (key: string, change: BoardChange) => Promise<boolean>
  toWriteColumn: (boardID: string, title: string) => Promise<string | undefined>
  toUpdateColumn: (key: string, change: ColumnChange) => Promise<boolean>
  toWriteCard: (value: CardWrite) => Promise<string | undefined>
  toUpdateCard: (key: string, change: CardChange) => Promise<boolean>
  toMoveCard: (cardID: string, toColumnID: string, toIndex: number) => Promise<boolean>
  toRemoveCard: (key: string) => Promise<boolean>
  toWriteTag: (boardID: string, title: string) => Promise<string | undefined>
  toAttachTag: (cardID: string, tagID: string) => Promise<boolean>
  toDetachTag: (cardID: string, tagID: string) => Promise<boolean>
  tagIDsForCard: (cardID: string) => string[]
  cardsInColumn: (columnID: string) => SignboardCard[]
}

const SEED_COLUMNS = ['待办', '进行中', '完成'] as const

const useSignboardStore = create<SignboardStore>()(
  devtools(
    immer(function (setter, getter) {
      return {
        boards: [],
        columns: [],
        cards: [],
        tags: [],
        cardTags: [],
        activeBoardID: null,
        loaded: false,

        tagIDsForCard(cardID) {
          return getter()
            .cardTags.filter(function (row) {
              return row.cardID === cardID
            })
            .map(function (row) {
              return row.tagID
            })
        },

        cardsInColumn(columnID) {
          return getter()
            .cards.filter(function (card) {
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
            const [columns, tags] = await Promise.all([
              invoke<SignboardColumn[]>(CHANNELS.SIGNBOARD_COLUMN.READ, {
                params: { boardID }
              }),
              invoke<SignboardTag[]>(CHANNELS.SIGNBOARD_TAG.READ, {
                params: { boardID }
              })
            ])

            const columnIDs = columns.map(function (column) {
              return column.id
            })
            let cards: SignboardCard[] = []
            if (columnIDs.length > 0) {
              cards = await invoke<SignboardCard[]>(CHANNELS.SIGNBOARD_CARD.READ, {
                params: columnIDs.map(function (columnID) {
                  return { columnID }
                })
              })
            }

            const cardIDs = cards.map(function (card) {
              return card.id
            })
            let cardTags: SignboardCardTag[] = []
            if (cardIDs.length > 0) {
              cardTags = await invoke<SignboardCardTag[]>(CHANNELS.SIGNBOARD_CARD_TAG.READ, {
                params: cardIDs.map(function (cardID) {
                  return { cardID }
                })
              })
            }

            setter(
              function (state) {
                state.activeBoardID = boardID
                state.columns = columns
                state.cards = cards
                state.tags = tags
                state.cardTags = cardTags
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

        async toWriteCard(value) {
          try {
            const index =
              value.index ??
              getter().cardsInColumn(value.columnID).length
            const ids = await invoke<string[]>(CHANNELS.SIGNBOARD_CARD.WRITE, {
              params: {
                columnID: value.columnID,
                title: value.title,
                notes: value.notes ?? '',
                index,
                dueAt: value.dueAt ?? null,
                reminderID: value.reminderID ?? null,
                priority: value.priority ?? 0,
                color: value.color ?? null
              }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return ids[0]
          } catch (error) {
            console.error('[signboard-store] toWriteCard failed:', error)
            return undefined
          }
        },

        async toUpdateCard(key, change) {
          try {
            await invoke(CHANNELS.SIGNBOARD_CARD.UPDATE, {
              params: { key, change }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            console.error('[signboard-store] toUpdateCard failed:', error)
            return false
          }
        },

        async toMoveCard(cardID, toColumnID, toIndex) {
          const previous = {
            cards: getter().cards.map(function (card) {
              return { ...card }
            })
          }
          const moving = getter().cards.find(function (card) {
            return card.id === cardID
          })
          if (!moving) return false

          const fromColumnID = moving.columnID
          setter(
            function (state) {
              const others = state.cards.filter(function (card) {
                return card.id !== cardID
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

              const reindexed = new Map<string, SignboardCard>()
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

              state.cards = state.cards.map(function (card) {
                return reindexed.get(card.id) ?? card
              })
            },
            false,
            'toMoveCard/optimistic'
          )

          try {
            const updates = getter()
              .cards.filter(function (card) {
                if (card.id === cardID) return true
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

            await invoke(CHANNELS.SIGNBOARD_CARD.UPDATE, {
              params: updates.length === 1 ? updates[0] : updates
            })
            return true
          } catch (error) {
            console.error('[signboard-store] toMoveCard failed:', error)
            setter(
              function (state) {
                state.cards = previous.cards
              },
              false,
              'toMoveCard/rollback'
            )
            return false
          }
        },

        async toRemoveCard(key) {
          try {
            await invoke(CHANNELS.SIGNBOARD_CARD.REMOVE, { params: key })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            console.error('[signboard-store] toRemoveCard failed:', error)
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

        async toAttachTag(cardID, tagID) {
          try {
            await invoke(CHANNELS.SIGNBOARD_CARD_TAG.WRITE, {
              params: { cardID, tagID }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            console.error('[signboard-store] toAttachTag failed:', error)
            return false
          }
        },

        async toDetachTag(cardID, tagID) {
          try {
            await invoke(CHANNELS.SIGNBOARD_CARD_TAG.REMOVE, {
              params: { cardID, tagID }
            })
            const boardID = getter().activeBoardID
            if (boardID) await getter().toActivateBoard(boardID)
            return true
          } catch (error) {
            console.error('[signboard-store] toDetachTag failed:', error)
            return false
          }
        }
      }
    }),
    { name: 'signboard-store' }
  )
)

export { useSignboardStore }
export type {
  BoardChange,
  CardChange,
  CardWrite,
  ColumnChange,
  SignboardBoard,
  SignboardCard,
  SignboardCardTag,
  SignboardColumn,
  SignboardTag
}
