/**
 * Tauri invoke / listen 频道单源；格式 namespace:action（事件可用 ://）。
 */
export const CHANNELS = {
  IPC: {
    INVOKE: 'ipc:invoke',
    READY: 'ipc:ready'
  },
  SYSTEM: {
    OS: 'system:os'
  },
  SIDECAR: {
    TO_READ: 'sidecar:toRead',
    ACTIONS: 'sidecar:actions',
    DIRECTIVES: 'sidecar:directives',
    DIRECTIVE: 'sidecar:directive',
    SAVE_DIRECTIVE: 'sidecar:saveDirective',
    DELETE_DIRECTIVE: 'sidecar:deleteDirective',
    IMPORT_DIRECTIVES: 'sidecar:importDirectives',
    EDIT_DIRECTIVE: 'sidecar:editDirective',
    RUN: 'sidecar:run',
    INVOKE: 'sidecar:invoke',
    LIST_RUNS: 'sidecar:listRuns',
    VALIDATE: 'sidecar:validate',
    CANCEL_EXECUTION: 'sidecar:cancelExecution',
    JOBS: 'sidecar:jobs',
    START_JOB: 'sidecar:startJob',
    STOP_JOB: 'sidecar:stopJob',
    SHUTDOWN: 'sidecar:shutdown'
  },
  AUTOSTART: {
    READ: 'autostart:read',
    UPDATE: 'autostart:update'
  },
  THROUGH: {
    UPDATE_RECTS: 'through:update-rects'
  },
  CAPTURE: {
    SCREENSHOT: 'capture:screenshot',
    OPEN: 'capture:open',
    CLOSE: 'capture:close',
    TAKE_PENDING: 'capture:take-pending',
    PRUNE: 'capture:prune'
  },
  OVERLAY: {
    ENSURE: 'overlay:ensure',
    HIDE: 'overlay:hide',
    UPDATE_MODE: 'overlay:update-mode',
    PING: 'overlay:ping',
    READ_MODE: 'overlay:read-mode',
    MOUNT: 'overlay:mount',
    UNMOUNT: 'overlay:unmount',
    TAKE_PENDING: 'overlay:take-pending',
    TAKE_PENDING_UNMOUNT: 'overlay:take-pending-unmount',
    READ: 'overlay:read',
    WRITE: 'overlay:write',
    UPDATE: 'overlay:update',
    REMOVE: 'overlay:remove'
  },
  ASSET: {
    READ: 'asset:read',
    INSERT: 'asset:insert',
    UPDATE: 'asset:update',
    REMOVE: 'asset:remove'
  },
  ALBUM: {
    READ: 'album:read',
    WRITE: 'album:write',
    UPDATE: 'album:update',
    REMOVE: 'album:remove'
  },
  BOOKMARK: {
    READ: 'bookmark:read',
    WRITE: 'bookmark:write',
    UPDATE: 'bookmark:update',
    REMOVE: 'bookmark:remove',
    IMPORT: 'bookmark:import'
  },
  MIRROR: {
    READ: 'mirror:read',
    WRITE: 'mirror:write',
    UPDATE: 'mirror:update',
    REMOVE: 'mirror:remove'
  },
  MAGNETIC_TILE: {
    READ: 'magnetic-tile:read',
    WRITE: 'magnetic-tile:write',
    UPDATE: 'magnetic-tile:update',
    REMOVE: 'magnetic-tile:remove'
  },
  COLLECTION: {
    READS: 'collection:reads'
  },
  CALENDAR: {
    READ: 'calendar:read',
    WRITE: 'calendar:write',
    UPDATE: 'calendar:update',
    REMOVE: 'calendar:remove'
  },
  SIGNBOARD: {
    READ: 'signboard:read',
    WRITE: 'signboard:write',
    UPDATE: 'signboard:update',
    REMOVE: 'signboard:remove'
  },
  SIGNBOARD_COLUMN: {
    READ: 'signboard-column:read',
    WRITE: 'signboard-column:write',
    UPDATE: 'signboard-column:update',
    REMOVE: 'signboard-column:remove'
  },
  SIGNBOARD_ENTRY: {
    READ: 'signboard-entry:read',
    WRITE: 'signboard-entry:write',
    UPDATE: 'signboard-entry:update',
    REMOVE: 'signboard-entry:remove'
  },
  SIGNBOARD_ENTRY_ASSET: {
    READ: 'signboard-entry-asset:read',
    WRITE: 'signboard-entry-asset:write',
    UPDATE: 'signboard-entry-asset:update',
    REMOVE: 'signboard-entry-asset:remove'
  },
  SIGNBOARD_TAG: {
    READ: 'signboard-tag:read',
    WRITE: 'signboard-tag:write',
    UPDATE: 'signboard-tag:update',
    REMOVE: 'signboard-tag:remove'
  },
  SIGNBOARD_TAGGED: {
    READ: 'signboard-tagged:read',
    WRITE: 'signboard-tagged:write',
    REMOVE: 'signboard-tagged:remove'
  },
  SIGNBOARD_CHECK: {
    READ: 'signboard-check:read',
    WRITE: 'signboard-check:write',
    UPDATE: 'signboard-check:update',
    REMOVE: 'signboard-check:remove'
  },
  SIGNBOARD_AUTOMATION: {
    READ: 'signboard-automation:read',
    WRITE: 'signboard-automation:write',
    UPDATE: 'signboard-automation:update',
    REMOVE: 'signboard-automation:remove'
  },
  REMINDER: {
    READ: 'reminder:read',
    WRITE: 'reminder:write',
    UPDATE: 'reminder:update',
    REMOVE: 'reminder:remove'
  },
  COUNTDOWN: {
    READ: 'countdown:read',
    UPDATE: 'countdown:update'
  },
  AGENT_SESSION: {
    TO_READ: 'agentSession:toRead',
    TO_WRITE: 'agentSession:toWrite',
    TO_UPDATE: 'agentSession:toUpdate',
    TO_REMOVE: 'agentSession:toRemove'
  },
  AGENT_MESSAGE: {
    TO_READ: 'agentMessage:toRead',
    TO_WRITE: 'agentMessage:toWrite',
    TO_UPDATE: 'agentMessage:toUpdate',
    TO_REMOVE: 'agentMessage:toRemove'
  },
  AGENT_WORKSPACE: {
    TO_READ: 'agentWorkspace:toRead',
    TO_WRITE: 'agentWorkspace:toWrite',
    TO_UPDATE: 'agentWorkspace:toUpdate',
    TO_REMOVE: 'agentWorkspace:toRemove'
  },
  AGENT_WORKSPACE_FOLDER: {
    TO_READ: 'agentWorkspaceFolder:toRead',
    TO_WRITE: 'agentWorkspaceFolder:toWrite',
    TO_UPDATE: 'agentWorkspaceFolder:toUpdate',
    TO_REMOVE: 'agentWorkspaceFolder:toRemove'
  },
  AGENT_PROVIDER: {
    TO_READ: 'agentProvider:toRead',
    TO_WRITE: 'agentProvider:toWrite',
    TO_UPDATE: 'agentProvider:toUpdate',
    TO_REMOVE: 'agentProvider:toRemove'
  },
  AGENT_USAGE: {
    TO_READ: 'agentUsage:toRead',
    TO_WRITE: 'agentUsage:toWrite',
    TO_UPDATE: 'agentUsage:toUpdate',
    TO_REMOVE: 'agentUsage:toRemove'
  },
  GOOSE: {
    READY: 'goose:ready',
    CONNECTION: 'goose:connection',
    ACP_OPEN: 'goose:acp-open',
    ACP_SEND: 'goose:acp-send',
    ACP_CLOSE: 'goose:acp-close'
  },
  COGITO: {
    TOKEN_WRITE: 'cogito:token:write',
    TOKEN_CLEAR: 'cogito:token:clear',
    PROVIDER_ENSURE: 'cogito:provider:ensure',
    PROVIDER_SET_TENANT: 'cogito:provider:set-tenant'
  },
  WORKSPACE_GIT: {
    PROBE: 'workspaceGit:probe',
    BRANCHES: 'workspaceGit:branches',
    CHECKOUT: 'workspaceGit:checkout'
  },
  WORKSPACE_FILES: {
    LIST_DIR: 'workspaceFiles:listDir',
    SEARCH: 'workspaceFiles:search',
    READ_FILE: 'workspaceFiles:readFile'
  },
  SEARCH: {
    SUGGEST: 'search:suggest'
  },
  WORKSPACE_SKILLS: {
    LIST: 'workspaceSkills:list'
  },
  TERMINAL: {
    CREATE: 'terminal:create',
    WRITE: 'terminal:write',
    RESIZE: 'terminal:resize',
    KILL: 'terminal:kill',
    LIST: 'terminal:list',
    FONT: 'terminal:font'
  }
} as const

/** 推送 / listen 事件（与 invoke 分表） */
export const EVENTS = {
  TRAY_ACTION: 'tray:action',
  REMINDER_FIRED: 'reminder:fired',
  COREX_NOT_READY: 'corex://not-ready',
  /** corex run / invoke 流式步骤帧（带 runId） */
  SIDECAR_PROGRESS: 'sidecar:progress',
  GOOSE_NOT_READY: 'goose://not-ready',
  GOOSE_ACP_MESSAGE: 'goose://acp-message',
  GOOSE_ACP_CLOSE: 'goose://acp-close',
  GOOSE_ACP_ERROR: 'goose://acp-error',
  OVERLAY_MODE: 'overlay://mode',
  OVERLAY_MOUNT: 'overlay://mount',
  OVERLAY_UNMOUNT: 'overlay://unmount',
  OVERLAY_CLEAR_TEXTURES: 'overlay://clear-textures',
  OVERLAY_HIDE: 'overlay://hide',
  OVERLAY_CONCEAL: 'overlay://conceal',
  OVERLAY_REVEAL: 'overlay://reveal',
  TERMINAL_EXIT: 'terminal://exit'
} as const

/** corex-daemon 经 ipc:invoke 的模块名 */
export const DAEMON = {
  FILE: 'file',
  MORPH: 'morph'
} as const

/** daemon action 名 */
export const DAEMON_ACTION = {
  FILE: {
    READ: 'read',
    WRITE: 'write',
    COPY: 'copy',
    DELETE: 'delete'
  },
  MORPH: {
    META: 'meta',
    RENDER: 'render',
    THUMBNAILS: 'thumbnails',
    MATCH: 'match',
    EXPORT: 'export',
    MERGE: 'merge',
    STACK: 'stack',
    SPLIT: 'split',
    IMAGES: 'images',
    DOCUMENT: 'document',
    REORDER: 'reorder',
    ROTATE: 'rotate',
    REMOVE: 'remove',
    EXTRACT: 'extract'
  }
} as const
