/**
 * Tauri invoke / listen 频道单源；格式 namespace:action（事件可用 ://）。
 */
export const CHANNELS = {
  IPC: {
    INVOKE: 'ipc:invoke',
    READY: 'ipc:ready'
  },
  SYSTEM: {
    OS: 'system:os',
    PROXY_APPLY: 'system:proxy-apply',
    PROXY_STATUS: 'system:proxy-status'
  },
  BRIDGE: {
    INFO: 'bridge:info'
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
  DIRECTIVE_DRAFT: {
    SAVE: 'directiveDraft:save',
    LIST: 'directiveDraft:list',
    SET_STATUS: 'directiveDraft:setStatus',
    REMOVE: 'directiveDraft:remove'
  },
  DICT: {
    LIST: 'dict:list',
    LIST_BY_TYPES: 'dict:listByTypes',
    UPDATE_ITEM: 'dict:updateItem',
    FIND_VALUE: 'dict:findValue',
    MERGE_REMOTE: 'dict:mergeRemote'
  },
  KNOWLEDGE: {
    EXTRACT_PDF: 'knowledge:extract-pdf',
    FIND_PDFIUM: 'knowledge:find-pdfium',
    LIST_BASES: 'knowledge:listBases',
    CREATE_BASE: 'knowledge:createBase',
    UPDATE_BASE: 'knowledge:updateBase',
    LIST_DOCS: 'knowledge:listDocs',
    CLOUD_DOCS: 'knowledge:cloudDocs',
    CLOUD_STATES: 'knowledge:cloudStates',
    SET_CLOUD_STATE: 'knowledge:cloudState',
    SEARCH: 'knowledge:search',
    LIST_STAGING: 'knowledge:listStaging',
    PUBLISH: 'knowledge:publish',
    DISCARD_STAGING: 'knowledge:discardStaging',
    MERGE_STAGING: 'knowledge:mergeStaging',
    RESCAN: 'knowledge:rescan',
    REMOVE_DOC: 'knowledge:removeDoc',
    RESOLVE_DOC: 'knowledge:resolveDoc',
    WRITE_DOC: 'knowledge:writeDoc',
    EXPORT_BUNDLE: 'knowledge:exportBundle'
  },
  AUTOMATION: {
    SAVE: 'automation:save',
    LIST: 'automation:list',
    SET_ENABLED: 'automation:setEnabled',
    REMOVE: 'automation:remove',
    RUN_NOW: 'automation:runNow',
    FINISH_RUN: 'automation:finishRun',
    TOUCH_RUN: 'automation:touchRun',
    PATCH_RUN: 'automation:patchRun',
    RUNS: 'automation:runs'
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
    REFRESH: 'capture:refresh',
    CLOSE: 'capture:close',
    TAKE_PENDING: 'capture:take-pending',
    READY: 'capture:ready',
    ELEMENTS: 'capture:elements',
    OCR: 'capture:ocr',
    PRUNE: 'capture:prune',
    HOTKEY: 'capture:hotkey',
    CURSOR: 'capture:cursor'
  },
  OVERLAY: {
    ENSURE: 'overlay:ensure',
    HIDE: 'overlay:hide',
    PARK: 'overlay:park',
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
    REMOVE: 'overlay:remove',
    REPORT_CONTENT: 'overlay:report-content',
    CONCEALED: 'overlay:concealed'
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
  /** 会话级计划档案（一行一个会话，`sessionID` 唯一） */
  AGENT_PLAN: {
    TO_READ: 'agentPlan:toRead',
    TO_WRITE: 'agentPlan:toWrite',
    TO_UPDATE: 'agentPlan:toUpdate',
    TO_REMOVE: 'agentPlan:toRemove'
  },
  /** 会话级目标推进档案（一行一个会话，`sessionID` 唯一） */
  AGENT_GOAL: {
    TO_READ: 'agentGoal:toRead',
    TO_WRITE: 'agentGoal:toWrite',
    TO_UPDATE: 'agentGoal:toUpdate',
    TO_REMOVE: 'agentGoal:toRemove'
  },
  AGENT_MESSAGE: {
    TO_READ: 'agentMessage:toRead',
    TO_WRITE: 'agentMessage:toWrite',
    TO_UPDATE: 'agentMessage:toUpdate',
    TO_REMOVE: 'agentMessage:toRemove',
    LOAD_THREAD: 'agentMessage:loadThread'
  },
  AGENT_TURN: {
    ENSURE: 'agentTurn:ensure',
    APPEND: 'agentTurn:append',
    FOLLOW: 'agentTurn:follow',
    FINISH: 'agentTurn:finish',
    FORGET: 'agentTurn:forget',
    MARK_RUNNING: 'agentTurn:markRunning',
    CLEAR_RUNNING: 'agentTurn:clearRunning',
    LIST_RUNNING: 'agentTurn:listRunning'
  },
  AGENT_TOOL: {
    LINE_DIFF: 'agentTool:lineDiff',
    NORMALIZE_OUTPUT: 'agentTool:normalizeOutput'
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
  CURSOR_AGENT: {
    STATUS: 'cursor-agent:status'
  },
  SECRET: {
    GET: 'secret:get',
    SET: 'secret:set',
    DELETE: 'secret:delete'
  },
  WORKSPACE_GIT: {
    PROBE: 'workspaceGit:probe',
    BRANCHES: 'workspaceGit:branches',
    CHECKOUT: 'workspaceGit:checkout',
    STATUS: 'workspaceGit:status',
    INVALIDATE: 'workspaceGit:invalidate',
    DIFF: 'workspaceGit:diff',
    DIFF_META: 'workspaceGit:diffMeta',
    DIFF_HUNKS: 'workspaceGit:diffHunks',
    SEARCH: 'workspaceGit:search',
    SHOW: 'workspaceGit:show',
    STAGE: 'workspaceGit:stage',
    UNSTAGE: 'workspaceGit:unstage',
    DISCARD: 'workspaceGit:discard',
    COMMIT: 'workspaceGit:commit',
    FETCH: 'workspaceGit:fetch',
    PULL: 'workspaceGit:pull',
    UPSTREAM: 'workspaceGit:upstream',
    PUSH: 'workspaceGit:push',
    STATE: 'workspaceGit:state',
    STASH_PUSH: 'workspaceGit:stashPush',
    STASH_APPLY: 'workspaceGit:stashApply',
    STASH_DROP: 'workspaceGit:stashDrop',
    REBASE: 'workspaceGit:rebase',
    REBASE_CONTINUE: 'workspaceGit:rebaseContinue',
    REBASE_ABORT: 'workspaceGit:rebaseAbort'
  },
  WORKSPACE_FILES: {
    LIST_DIR: 'workspaceFiles:listDir',
    SEARCH: 'workspaceFiles:search',
    CONTENT: 'workspaceFiles:content',
    REPLACE: 'workspaceFiles:replace',
    READ_FILE: 'workspaceFiles:readFile',
    PACK_TYPES: 'workspaceFiles:packTypes',
    WATCH: 'workspaceFiles:watch',
    UNWATCH: 'workspaceFiles:unwatch',
    CHANGED: 'workspaceFiles:changed'
  },
  SEARCH: {
    SUGGEST: 'search:suggest'
  },
  SITE: {
    FETCH_FAVICON: 'site:fetch-favicon'
  },
  WORKSPACE_SKILLS: {
    LIST: 'workspaceSkills:list'
  },
  TERMINAL: {
    CREATE: 'terminal:create',
    /** 接上一个已存在的会话（agent 先建、面板后挂）：回放缓冲 + 实时流 */
    ATTACH: 'terminal:attach',
    RUN: 'terminal:run',
    READ: 'terminal:read',
    WRITE: 'terminal:write',
    RESIZE: 'terminal:resize',
    KILL: 'terminal:kill',
    LIST: 'terminal:list',
    /** 把 cwd 规范成与 Hub 一致的 `agent:<canonical>` */
    RESOLVE_AGENT_ID: 'terminal:resolve_agent_id',
    FONT: 'terminal:font'
  }
} as const

/** 推送 / listen 事件（与 invoke 分表） */
export const EVENTS = {
  TRAY_ACTION: 'tray:action',
  REMINDER_FIRED: 'reminder:fired',
  /** 定时任务到期：worker 已 claim，等前端起会话执行后回写 */
  AUTOMATION_DUE: 'automation:due',
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
  TERMINAL_EXIT: 'terminal://exit',
  /** agent 在嵌入式终端里开始跑一条命令：前端据此开/选 tab 让用户看得见 */
  TERMINAL_AGENT_RUN: 'terminal://agent-run',
  /** agent 会话闲置过久被 Rust 回收：前端把 tab 标成已退出 */
  TERMINAL_IDLE_CLOSED: 'terminal://idle-closed'
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
