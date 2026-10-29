export { STORE_FILE, type PersistNamespace } from '@/features/persist/files'
export {
  ensurePersist,
  findPref,
  patchPref,
  replacePref,
  isPersistReady,
  resetPersistForTests
} from '@/features/persist/store'
export {
  AUTH_CHANGED,
  ensureSecrets,
  findJwtCache,
  writeJwtSecret,
  findProviderSecret,
  writeProviderSecret,
  subscribeAuthChanged
} from '@/features/persist/secrets'
export type {
  PersistShape,
  PersistValue,
  TileSessionPref,
  KnowledgeShell,
  CodeShell,
  TilesPref,
  AgentPref,
  WindowPref,
  VaultPref,
  GalleryPref,
  ClipchampPref,
  SettingsPref,
  SignboardViewMode,
  BookmarkViewMode,
  BookmarkSortKey,
  ClockStyle,
  ApprovalMode,
  ModelPref,
  ThinkingLevel,
  AgentSplitterOpen
} from '@/features/persist/types'
export { PERSIST_DEFAULTS } from '@/features/persist/defaults'
