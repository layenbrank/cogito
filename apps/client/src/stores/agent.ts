import { invoke } from '@tauri-apps/api/core'
import { Subject } from 'rxjs'
import { create, type StateCreator } from 'zustand'
import { devtools, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { CHANNELS } from '@/shared/ipc/channels'

type Session = MagneticTile.Agent.Session
type Message = MagneticTile.Agent.Message
type Workspace = MagneticTile.Agent.Workspace
type WorkspaceFolder = MagneticTile.Agent.WorkspaceFolder
type Usage = MagneticTile.Agent.Usage

interface SessionChange {
  title?: string
  pinned?: boolean
  providerID?: string | null
  workspaceID?: string | null
}

interface MessageChange {
  identity?: Message['identity']
  fragment?: string
  thinking?: string | null
  parts?: string | null
  sessionID?: string
  updatedAt?: number
}

interface SessionUpdate {
  key: string
  change: SessionChange
}

interface MessageUpdate {
  key: string
  change: MessageChange
}

type EventType =
  | 'SESSION:INSERTED'
  | 'SESSION:UPDATED'
  | 'SESSION:REMOVED'
  | 'SESSION:TOREAD'
  | 'SESSION:SYNCED'
  | 'MESSAGE:SYNCED'
  | 'MESSAGE:TOREAD'
  | 'MESSAGE:INSERTED'
  | 'MESSAGE:UPDATED'
  | 'MESSAGE:REMOVED'
  | 'WORKSPACE:SYNCED'
  | 'WORKSPACE_FOLDER:SYNCED'

interface AgentEvent<T = unknown> {
  type: EventType
  payload: T
  timestamp: number
}

interface SessionSlice {
  sessions: Session[]
  activeSessionID: string | null
  sessionsLoaded: boolean

  toReadSessions(): Promise<Session[]>
  toReadSession(key: string): Session | null
  toWriteSession(values: Session[]): Promise<void>
  toUpdateSession(values: Partial<Session>[]): Promise<void>
  toRemoveSession(keys: string[]): Promise<void>
  toUpdateSessions(sessions: Session[]): void
}

interface MessageSlice {
  messages: Message[]
  messagesLoaded: boolean

  toReadMessages(sessionID?: string): Promise<Message[]>
  toReadMessage(key: string): Message | null
  toWriteMessage(values: Message[]): Promise<void>
  toUpdateMessage(values: Partial<Message>[], options?: { skip?: boolean }): Promise<void>
  toRemoveMessage(keys: string[]): Promise<void>
  toUpdateMessages(messages: Message[]): void
}

interface WorkspaceSlice {
  workspaces: Workspace[]
  workspaceFolders: WorkspaceFolder[]
  activeWorkspaceID: string | null
  workspacesLoaded: boolean
  workspaceFoldersLoaded: boolean

  toReadWorkspaces(): Promise<Workspace[]>
  toWriteWorkspace(values: Workspace[]): Promise<void>
  toUpdateWorkspace(values: Partial<Workspace>[]): Promise<void>
  toRemoveWorkspace(keys: string[]): Promise<void>
  toUpdateWorkspaces(workspaces: Workspace[]): void
  toActivateWorkspace(workspaceID: string | null): void

  toReadWorkspaceFolders(workspaceID?: string): Promise<WorkspaceFolder[]>
  toWriteWorkspaceFolder(values: WorkspaceFolder[]): Promise<void>
  toUpdateWorkspaceFolder(values: Partial<WorkspaceFolder>[]): Promise<void>
  toRemoveWorkspaceFolder(keys: string[]): Promise<void>
  toReplaceWorkspaceFolders(workspaceID: string, folders: WorkspaceFolder[]): Promise<void>
}

type AgentStore = SessionSlice & MessageSlice & WorkspaceSlice

type SliceCreator<T> = StateCreator<
  AgentStore,
  [['zustand/devtools', never], ['zustand/subscribeWithSelector', never], ['zustand/immer', never]],
  [],
  T
>

const event$ = new Subject<AgentEvent>()

function toSessionWrite(value: Session) {
  return {
    id: value.id,
    title: value.title,
    pinned: value.pinned,
    providerID: value.providerID,
    workspaceID: value.workspaceID,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  }
}

function toMessageWrite(value: Message) {
  return {
    id: value.id,
    identity: value.identity,
    fragment: value.fragment,
    thinking: value.thinking,
    parts: value.parts,
    sessionID: value.sessionID,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  }
}

function toWorkspaceWrite(value: Workspace) {
  return {
    id: value.id,
    title: value.title,
    icon: value.icon,
    color: value.color,
    pinned: value.pinned,
    archivedAt: value.archivedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  }
}

function toWorkspaceFolderWrite(value: WorkspaceFolder) {
  return {
    id: value.id,
    workspaceID: value.workspaceID,
    path: value.path,
    isPrimary: value.isPrimary,
    sort: value.sort,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  }
}

const sessionSlice: SliceCreator<SessionSlice> = function (setters, getters) {
  return {
    sessions: [],
    activeSessionID: null,
    sessionsLoaded: false,

    async toReadSessions() {
      try {
        const sessions = await invoke<Session[]>(CHANNELS.AGENT_SESSION.TO_READ, { params: {} })
        setters(
          function (state) {
            state.sessions = sessions
            state.sessionsLoaded = true
            if (!state.activeSessionID && sessions[0]) {
              state.activeSessionID = sessions[0].id
            }
          },
          false,
          'toReadSessions'
        )
        const activeSessionID = getters().activeSessionID
        if (activeSessionID) {
          await getters().toReadMessages(activeSessionID)
        }
        event$.next({
          type: 'SESSION:SYNCED',
          payload: sessions,
          timestamp: Date.now()
        })
        return sessions
      } catch (error) {
        console.error('[agent-store] toReadSessions failed:', error)
        setters(
          function (state) {
            state.sessionsLoaded = true
          },
          false,
          'toReadSessions/error'
        )
        return []
      }
    },

    toReadSession(key: string) {
      const now = Date.now()
      const sessions = getters().sessions
      const session = sessions.find(function (item) {
        return item.id === key
      })

      setters(
        function (state) {
          state.activeSessionID = key
        },
        false,
        'toReadSession/active'
      )

      event$.next({
        type: 'SESSION:TOREAD',
        payload: { session },
        timestamp: now
      })

      return session ?? null
    },

    async toWriteSession(values: Session[]) {
      const former = structuredClone(getters().sessions)
      setters(
        function (state) {
          state.sessions.push(...values)
        },
        false,
        'toWriteSession/optimistic'
      )

      try {
        await invoke(CHANNELS.AGENT_SESSION.TO_WRITE, {
          params: values.map(toSessionWrite)
        })
        event$.next({
          type: 'SESSION:INSERTED',
          payload: values,
          timestamp: Date.now()
        })
      } catch (error) {
        setters({ sessions: former }, false, 'toWriteSession/rollback')
        throw error
      }
    },

    async toUpdateSession(values: Partial<Session>[]) {
      const hasID = values.every(function (v) {
        return Boolean(v.id)
      })
      if (!hasID) throw new Error('ID is required')

      const sessions = structuredClone(getters().sessions)
      const updatesMap = new Map<string, Partial<Session>>()
      values.forEach(function (v) {
        if (v.id) updatesMap.set(v.id, v)
      })

      setters(
        function (state) {
          state.sessions = sessions.map(function (item) {
            const update = updatesMap.get(item.id)
            if (!update) return item
            return Object.assign({}, item, update)
          })
        },
        false,
        'toUpdateSession/optimistic'
      )

      try {
        const params: SessionUpdate[] = values.map(function (v) {
          const { id, ...change } = v
          return { key: id!, change }
        })
        await invoke(CHANNELS.AGENT_SESSION.TO_UPDATE, { params })
        event$.next({
          type: 'SESSION:UPDATED',
          payload: values,
          timestamp: Date.now()
        })
      } catch (error) {
        setters({ sessions }, false, 'toUpdateSession/rollback')
        throw error
      }
    },

    async toRemoveSession(keys: string[]) {
      const former = structuredClone(getters().sessions)
      try {
        setters(
          function (state) {
            const keySet = new Set(keys)
            state.sessions = former.filter(function (session) {
              return !keySet.has(session.id)
            })
            if (state.activeSessionID && keySet.has(state.activeSessionID)) {
              state.activeSessionID = state.sessions[0]?.id ?? null
            }
          },
          false,
          'toRemoveSession/optimistic'
        )
        await invoke(CHANNELS.AGENT_SESSION.TO_REMOVE, { params: keys })
        const activeSessionID = getters().activeSessionID
        if (activeSessionID) {
          await getters().toReadMessages(activeSessionID)
        }
        event$.next({
          type: 'SESSION:REMOVED',
          payload: keys,
          timestamp: Date.now()
        })
      } catch (error) {
        setters({ sessions: former }, false, 'toRemoveSession/rollback')
        throw error
      }
    },

    toUpdateSessions(sessions) {
      setters({ sessions }, false, 'toUpdateSessions/synced')
      event$.next({
        type: 'SESSION:SYNCED',
        payload: sessions,
        timestamp: Date.now()
      })
    }
  }
}

const messageSlice: SliceCreator<MessageSlice> = function (setters, getters) {
  return {
    messages: [],
    messagesLoaded: false,

    async toReadMessages(sessionID?: string) {
      try {
        const params = sessionID ? { sessionID } : {}
        const messages = await invoke<Message[]>(CHANNELS.AGENT_MESSAGE.TO_READ, { params })
        setters(
          function (state) {
            if (sessionID) {
              const others = state.messages.filter(function (message) {
                return message.sessionID !== sessionID
              })
              state.messages = others.concat(messages).toSorted(function (a, b) {
                return a.createdAt - b.createdAt
              })
            } else {
              state.messages = messages
            }
            state.messagesLoaded = true
          },
          false,
          'toReadMessages'
        )
        event$.next({
          type: 'MESSAGE:SYNCED',
          payload: messages,
          timestamp: Date.now()
        })
        return messages
      } catch (error) {
        console.error('[agent-store] toReadMessages failed:', error)
        setters(
          function (state) {
            state.messagesLoaded = true
          },
          false,
          'toReadMessages/error'
        )
        return []
      }
    },

    toReadMessage(key: string) {
      const message = getters().messages.find(function (item) {
        return item.id === key
      })
      event$.next({
        type: 'MESSAGE:TOREAD',
        payload: { message },
        timestamp: Date.now()
      })
      return message ?? null
    },

    async toWriteMessage(values: Message[]) {
      const former = structuredClone(getters().messages)
      setters(
        function (state) {
          state.messages = state.messages.concat(values)
        },
        false,
        'toWriteMessage/optimistic'
      )

      try {
        await invoke(CHANNELS.AGENT_MESSAGE.TO_WRITE, {
          params: values.map(toMessageWrite)
        })
        event$.next({
          type: 'MESSAGE:INSERTED',
          payload: values,
          timestamp: Date.now()
        })
      } catch (error) {
        setters({ messages: former }, false, 'toWriteMessage/rollback')
        throw error
      }
    },

    async toUpdateMessage(values: Partial<Message>[], options?: { skip?: boolean }) {
      const hasID = values.every(function (v) {
        return Boolean(v.id)
      })
      if (!hasID) throw new Error('ID is required')

      const messages = structuredClone(getters().messages)
      const updatesMap = new Map<string, Partial<Message>>()
      values.forEach(function (v) {
        if (v.id) updatesMap.set(v.id, v)
      })

      setters(
        function (state) {
          state.messages = state.messages
            .map(function (item) {
              const update = updatesMap.get(item.id)
              if (!update) return item
              return Object.assign({}, item, update)
            })
            .toSorted(function (a, b) {
              return a.createdAt - b.createdAt
            })
        },
        false,
        'toUpdateMessage/optimistic'
      )

      if (options?.skip) return

      try {
        const params: MessageUpdate[] = values.map(function (v) {
          const { id, ...change } = v
          return { key: id!, change }
        })
        await invoke(CHANNELS.AGENT_MESSAGE.TO_UPDATE, { params })
        event$.next({
          type: 'MESSAGE:UPDATED',
          payload: values,
          timestamp: Date.now()
        })
      } catch (error) {
        setters({ messages }, false, 'toUpdateMessage/rollback')
        throw error
      }
    },

    async toRemoveMessage(keys: string[]) {
      const former = structuredClone(getters().messages)
      try {
        setters(
          function (state) {
            const keySet = new Set(keys)
            state.messages = former.filter(function (message) {
              return !keySet.has(message.id)
            })
          },
          false,
          'toRemoveMessage/optimistic'
        )
        await invoke(CHANNELS.AGENT_MESSAGE.TO_REMOVE, { params: keys })
        event$.next({
          type: 'MESSAGE:REMOVED',
          payload: keys,
          timestamp: Date.now()
        })
      } catch (error) {
        setters({ messages: former }, false, 'toRemoveMessage/rollback')
        throw error
      }
    },

    toUpdateMessages(messages) {
      setters({ messages }, false, 'toUpdateMessages/synced')
      event$.next({
        type: 'MESSAGE:SYNCED',
        payload: messages,
        timestamp: Date.now()
      })
    }
  }
}

const workspaceSlice: SliceCreator<WorkspaceSlice> = function (setters, getters) {
  return {
    workspaces: [],
    workspaceFolders: [],
    activeWorkspaceID: null,
    workspacesLoaded: false,
    workspaceFoldersLoaded: false,

    async toReadWorkspaces() {
      try {
        const workspaces = await invoke<Workspace[]>(CHANNELS.AGENT_WORKSPACE.TO_READ, {
          params: { archived: false }
        })
        setters(
          function (state) {
            state.workspaces = workspaces
            state.workspacesLoaded = true
            if (!state.activeWorkspaceID && workspaces[0]) {
              state.activeWorkspaceID = workspaces[0].id
            }
          },
          false,
          'toReadWorkspaces'
        )
        event$.next({
          type: 'WORKSPACE:SYNCED',
          payload: workspaces,
          timestamp: Date.now()
        })
        return workspaces
      } catch (error) {
        console.error('[agent-store] toReadWorkspaces failed:', error)
        setters(
          function (state) {
            state.workspacesLoaded = true
          },
          false,
          'toReadWorkspaces/error'
        )
        return []
      }
    },

    async toWriteWorkspace(values: Workspace[]) {
      const former = structuredClone(getters().workspaces)
      setters(
        function (state) {
          state.workspaces.push(...values)
          if (!state.activeWorkspaceID && values[0]) {
            state.activeWorkspaceID = values[0].id
          }
        },
        false,
        'toWriteWorkspace/optimistic'
      )
      try {
        await invoke(CHANNELS.AGENT_WORKSPACE.TO_WRITE, {
          params: values.map(toWorkspaceWrite)
        })
      } catch (error) {
        setters({ workspaces: former }, false, 'toWriteWorkspace/rollback')
        throw error
      }
    },

    async toUpdateWorkspace(values: Partial<Workspace>[]) {
      const hasID = values.every(function (v) {
        return Boolean(v.id)
      })
      if (!hasID) throw new Error('ID is required')

      const workspaces = structuredClone(getters().workspaces)
      const updatesMap = new Map<string, Partial<Workspace>>()
      values.forEach(function (v) {
        if (v.id) updatesMap.set(v.id, v)
      })

      setters(
        function (state) {
          state.workspaces = workspaces
            .map(function (item) {
              const update = updatesMap.get(item.id)
              if (!update) return item
              return Object.assign({}, item, update)
            })
            .filter(function (item) {
              return !item.archivedAt
            })
          if (
            state.activeWorkspaceID &&
            !state.workspaces.some(function (item) {
              return item.id === state.activeWorkspaceID
            })
          ) {
            state.activeWorkspaceID = state.workspaces[0]?.id ?? null
          }
        },
        false,
        'toUpdateWorkspace/optimistic'
      )

      try {
        const params = values.map(function (v) {
          const { id, ...change } = v
          return { key: id!, change }
        })
        await invoke(CHANNELS.AGENT_WORKSPACE.TO_UPDATE, { params })
      } catch (error) {
        setters({ workspaces }, false, 'toUpdateWorkspace/rollback')
        throw error
      }
    },

    async toRemoveWorkspace(keys: string[]) {
      const former = structuredClone(getters().workspaces)
      const formerFolders = structuredClone(getters().workspaceFolders)
      try {
        setters(
          function (state) {
            const keySet = new Set(keys)
            state.workspaces = former.filter(function (workspace) {
              return !keySet.has(workspace.id)
            })
            state.workspaceFolders = formerFolders.filter(function (folder) {
              return !keySet.has(folder.workspaceID)
            })
            if (state.activeWorkspaceID && keySet.has(state.activeWorkspaceID)) {
              state.activeWorkspaceID = state.workspaces[0]?.id ?? null
            }
          },
          false,
          'toRemoveWorkspace/optimistic'
        )
        await invoke(CHANNELS.AGENT_WORKSPACE.TO_REMOVE, { params: keys })
      } catch (error) {
        setters(
          { workspaces: former, workspaceFolders: formerFolders },
          false,
          'toRemoveWorkspace/rollback'
        )
        throw error
      }
    },

    toUpdateWorkspaces(workspaces) {
      setters({ workspaces }, false, 'toUpdateWorkspaces/synced')
      event$.next({
        type: 'WORKSPACE:SYNCED',
        payload: workspaces,
        timestamp: Date.now()
      })
    },

    toActivateWorkspace(workspaceID) {
      setters(
        function (state) {
          state.activeWorkspaceID = workspaceID
        },
        false,
        'toActivateWorkspace'
      )
    },

    async toReadWorkspaceFolders(workspaceID) {
      try {
        const params = workspaceID ? { workspaceID } : {}
        const folders = await invoke<WorkspaceFolder[]>(CHANNELS.AGENT_WORKSPACE_FOLDER.TO_READ, {
          params
        })
        setters(
          function (state) {
            if (workspaceID) {
              state.workspaceFolders = [
                ...state.workspaceFolders.filter(function (folder) {
                  return folder.workspaceID !== workspaceID
                }),
                ...folders
              ]
            } else {
              state.workspaceFolders = folders
            }
            state.workspaceFoldersLoaded = true
          },
          false,
          'toReadWorkspaceFolders'
        )
        event$.next({
          type: 'WORKSPACE_FOLDER:SYNCED',
          payload: folders,
          timestamp: Date.now()
        })
        return folders
      } catch (error) {
        console.error('[agent-store] toReadWorkspaceFolders failed:', error)
        setters(
          function (state) {
            state.workspaceFoldersLoaded = true
          },
          false,
          'toReadWorkspaceFolders/error'
        )
        return []
      }
    },

    async toWriteWorkspaceFolder(values: WorkspaceFolder[]) {
      const former = structuredClone(getters().workspaceFolders)
      setters(
        function (state) {
          state.workspaceFolders.push(...values)
        },
        false,
        'toWriteWorkspaceFolder/optimistic'
      )
      try {
        await invoke(CHANNELS.AGENT_WORKSPACE_FOLDER.TO_WRITE, {
          params: values.map(toWorkspaceFolderWrite)
        })
      } catch (error) {
        setters({ workspaceFolders: former }, false, 'toWriteWorkspaceFolder/rollback')
        throw error
      }
    },

    async toUpdateWorkspaceFolder(values: Partial<WorkspaceFolder>[]) {
      const hasID = values.every(function (v) {
        return Boolean(v.id)
      })
      if (!hasID) throw new Error('ID is required')

      const folders = structuredClone(getters().workspaceFolders)
      const updatesMap = new Map<string, Partial<WorkspaceFolder>>()
      values.forEach(function (v) {
        if (v.id) updatesMap.set(v.id, v)
      })

      setters(
        function (state) {
          state.workspaceFolders = folders.map(function (item) {
            const update = updatesMap.get(item.id)
            if (!update) return item
            return Object.assign({}, item, update)
          })
        },
        false,
        'toUpdateWorkspaceFolder/optimistic'
      )

      try {
        const params = values.map(function (v) {
          const { id, ...change } = v
          return { key: id!, change }
        })
        await invoke(CHANNELS.AGENT_WORKSPACE_FOLDER.TO_UPDATE, { params })
      } catch (error) {
        setters({ workspaceFolders: folders }, false, 'toUpdateWorkspaceFolder/rollback')
        throw error
      }
    },

    async toRemoveWorkspaceFolder(keys: string[]) {
      const former = structuredClone(getters().workspaceFolders)
      try {
        setters(
          function (state) {
            const keySet = new Set(keys)
            state.workspaceFolders = former.filter(function (folder) {
              return !keySet.has(folder.id)
            })
          },
          false,
          'toRemoveWorkspaceFolder/optimistic'
        )
        await invoke(CHANNELS.AGENT_WORKSPACE_FOLDER.TO_REMOVE, { params: keys })
      } catch (error) {
        setters({ workspaceFolders: former }, false, 'toRemoveWorkspaceFolder/rollback')
        throw error
      }
    },

    async toReplaceWorkspaceFolders(workspaceID, folders) {
      const former = structuredClone(getters().workspaceFolders)
      const removeKeys = former
        .filter(function (folder) {
          return folder.workspaceID === workspaceID
        })
        .map(function (folder) {
          return folder.id
        })

      setters(
        function (state) {
          state.workspaceFolders = [
            ...former.filter(function (folder) {
              return folder.workspaceID !== workspaceID
            }),
            ...folders
          ]
        },
        false,
        'toReplaceWorkspaceFolders/optimistic'
      )

      try {
        if (removeKeys.length) {
          await invoke(CHANNELS.AGENT_WORKSPACE_FOLDER.TO_REMOVE, { params: removeKeys })
        }
        if (folders.length) {
          await invoke(CHANNELS.AGENT_WORKSPACE_FOLDER.TO_WRITE, {
            params: folders.map(toWorkspaceFolderWrite)
          })
        }
      } catch (error) {
        setters({ workspaceFolders: former }, false, 'toReplaceWorkspaceFolders/rollback')
        throw error
      }
    }
  }
}

const useAgentStore = create<AgentStore>()(
  devtools(
    subscribeWithSelector(
      immer(function (...args) {
        return {
          ...sessionSlice(...args),
          ...messageSlice(...args),
          ...workspaceSlice(...args)
        }
      })
    ),
    {
      name: 'AgentStore',
      enabled: import.meta.env.DEV
    }
  )
)

export {
  event$,
  useAgentStore,
  type Message,
  type MessageUpdate,
  type Session,
  type SessionUpdate,
  type Usage,
  type Workspace,
  type WorkspaceFolder
}
