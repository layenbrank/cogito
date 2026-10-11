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
    TAKE_PENDING: 'capture:take-pending'
  },
  OVERLAY: {
    ENSURE: 'overlay:ensure',
    HIDE: 'overlay:hide',
    UPDATE_MODE: 'overlay:update-mode',
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
    INSERT: 'asset:insert'
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
  AI_SESSION: {
    TO_READ: 'aiSession:toRead',
    TO_WRITE: 'aiSession:toWrite',
    TO_UPDATE: 'aiSession:toUpdate',
    TO_REMOVE: 'aiSession:toRemove'
  },
  AI_MESSAGE: {
    TO_READ: 'aiMessage:toRead',
    TO_WRITE: 'aiMessage:toWrite',
    TO_UPDATE: 'aiMessage:toUpdate',
    TO_REMOVE: 'aiMessage:toRemove'
  },
  AI_WORKSPACE: {
    TO_READ: 'aiWorkspace:toRead',
    TO_WRITE: 'aiWorkspace:toWrite',
    TO_UPDATE: 'aiWorkspace:toUpdate',
    TO_REMOVE: 'aiWorkspace:toRemove'
  },
  AI_WORKSPACE_FOLDER: {
    TO_READ: 'aiWorkspaceFolder:toRead',
    TO_WRITE: 'aiWorkspaceFolder:toWrite',
    TO_UPDATE: 'aiWorkspaceFolder:toUpdate',
    TO_REMOVE: 'aiWorkspaceFolder:toRemove'
  },
  AI_PROVIDER: {
    TO_READ: 'aiProvider:toRead',
    TO_WRITE: 'aiProvider:toWrite',
    TO_UPDATE: 'aiProvider:toUpdate',
    TO_REMOVE: 'aiProvider:toRemove'
  },
  GOOSE: {
    READY: 'goose:ready',
    CONNECTION: 'goose:connection',
    ACP_OPEN: 'goose:acp-open',
    ACP_SEND: 'goose:acp-send',
    ACP_CLOSE: 'goose:acp-close'
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
  WORKSPACE_SKILLS: {
    LIST: 'workspaceSkills:list'
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
  OVERLAY_REVEAL: 'overlay://reveal'
} as const

/** corex-daemon 经 ipc:invoke 的模块名 */
export const DAEMON = {
  ENGINE: 'engine',
  FILE: 'file',
  MORPH: 'morph'
} as const

/** daemon action 名 */
export const DAEMON_ACTION = {
  ENGINE: {
    SUGGESTION: 'suggestion'
  },
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
