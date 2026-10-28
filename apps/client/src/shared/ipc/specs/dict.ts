/**
 * 状态字典 IPC 契约（value 稳定编码，label 可改文案）。
 */
import { z } from 'zod'

const DictItemSchema = z.object({
  id: z.string(),
  typeCode: z.string(),
  value: z.string(),
  label: z.string(),
  sort: z.number(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  meta: z.string().nullish()
})

const DictTypeSchema = z.object({
  typeCode: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  items: z.array(DictItemSchema)
})

type DictItem = z.infer<typeof DictItemSchema>
type DictType = z.infer<typeof DictTypeSchema>

/** 与后端 codes 对齐的 typeCode */
const DICT_TYPE = {
  KNOWLEDGE_DOC_STATUS: 'knowledge_doc_status',
  KNOWLEDGE_DOC_SOURCE: 'knowledge_doc_source',
  KNOWLEDGE_CLOUD_STATUS: 'knowledge_cloud_status',
  KNOWLEDGE_BASE_SCOPE: 'knowledge_base_scope',
  AUTOMATION_RUN_STATUS: 'automation_run_status',
  AUTOMATION_TRIGGER_KIND: 'automation_trigger_kind',
  AUTOMATION_OWNER: 'automation_owner',
  AUTOMATION_RUN_AS: 'automation_run_as',
  DIRECTIVE_DRAFT_STATUS: 'directive_draft_status',
  ASSET_STATUS: 'asset_status',
  ALBUM_STATUS: 'album_status'
} as const

const DICT_VALUE = {
  KNOWLEDGE_DOC_STATUS: { DRAFT: '001', PUBLISHED: '002' },
  KNOWLEDGE_DOC_SOURCE: {
    MANUAL: '001',
    AGENT: '002',
    IMPORT: '003',
    AUTHORED: '004'
  },
  KNOWLEDGE_CLOUD_STATUS: {
    IDLE: '001',
    PENDING: '002',
    RUNNING: '003',
    SUCCEEDED: '004',
    FAILED: '005'
  },
  KNOWLEDGE_BASE_SCOPE: { USER: '001', TENANT: '002' },
  AUTOMATION_RUN_STATUS: {
    PENDING: '001',
    RUNNING: '002',
    SUCCEEDED: '003',
    FAILED: '004'
  },
  AUTOMATION_TRIGGER_KIND: {
    SCHEDULE: '001',
    MANUAL: '002',
    CATCHUP: '003'
  },
  AUTOMATION_OWNER: { CLIENT: '001', GOOSE: '002', CLOUD: '003' },
  AUTOMATION_RUN_AS: { USER: '001', TENANT: '002' },
  DIRECTIVE_DRAFT_STATUS: {
    PENDING: '001',
    SAVED: '002',
    DISCARDED: '003'
  },
  ASSET_STATUS: { ACTIVE: '001' },
  ALBUM_STATUS: { ACTIVE: '001' }
} as const

export type { DictItem, DictType }
export { DictItemSchema, DictTypeSchema, DICT_TYPE, DICT_VALUE }
