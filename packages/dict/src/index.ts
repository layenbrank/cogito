/**
 * 产品状态字典契约（与 docs/contracts/dict.yaml 对齐）。
 * 业务分支认 key；value 为全局分配号。
 */

const DICT_REVISION = 2

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

type DictTypeCode = (typeof DICT_TYPE)[keyof typeof DICT_TYPE]

/** 全局池 key → value */
const DICT_KEY = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  MANUAL: 'MANUAL',
  AGENT: 'AGENT',
  IMPORT: 'IMPORT',
  AUTHORED: 'AUTHORED',
  CLOUD_IDLE: 'CLOUD_IDLE',
  CLOUD_PENDING: 'CLOUD_PENDING',
  CLOUD_RUNNING: 'CLOUD_RUNNING',
  CLOUD_SUCCEEDED: 'CLOUD_SUCCEEDED',
  CLOUD_FAILED: 'CLOUD_FAILED',
  SCOPE_USER: 'SCOPE_USER',
  SCOPE_TENANT: 'SCOPE_TENANT',
  RUN_PENDING: 'RUN_PENDING',
  RUN_RUNNING: 'RUN_RUNNING',
  RUN_SUCCEEDED: 'RUN_SUCCEEDED',
  RUN_FAILED: 'RUN_FAILED',
  TRIGGER_SCHEDULE: 'TRIGGER_SCHEDULE',
  TRIGGER_MANUAL: 'TRIGGER_MANUAL',
  TRIGGER_CATCHUP: 'TRIGGER_CATCHUP',
  OWNER_CLIENT: 'OWNER_CLIENT',
  OWNER_GOOSE: 'OWNER_GOOSE',
  OWNER_CLOUD: 'OWNER_CLOUD',
  RUN_AS_USER: 'RUN_AS_USER',
  RUN_AS_TENANT: 'RUN_AS_TENANT',
  DRAFT_PENDING: 'DRAFT_PENDING',
  DRAFT_SAVED: 'DRAFT_SAVED',
  DRAFT_DISCARDED: 'DRAFT_DISCARDED',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED'
} as const

type DictKey = (typeof DICT_KEY)[keyof typeof DICT_KEY]

interface DictPoolItem {
  value: string
  key: DictKey
  label: string
  sort: number
  meta: string | null
}

const DICT_POOL = [
  { value: '001', key: DICT_KEY.DRAFT, label: '草稿', sort: 10, meta: null },
  { value: '002', key: DICT_KEY.PUBLISHED, label: '已发布', sort: 20, meta: null },
  { value: '003', key: DICT_KEY.MANUAL, label: '手动', sort: 10, meta: null },
  { value: '004', key: DICT_KEY.AGENT, label: '智能体', sort: 20, meta: null },
  { value: '005', key: DICT_KEY.IMPORT, label: '导入', sort: 30, meta: null },
  { value: '006', key: DICT_KEY.AUTHORED, label: '编辑撰写', sort: 40, meta: null },
  { value: '007', key: DICT_KEY.CLOUD_IDLE, label: '空闲', sort: 10, meta: null },
  { value: '008', key: DICT_KEY.CLOUD_PENDING, label: '待同步', sort: 20, meta: null },
  {
    value: '009',
    key: DICT_KEY.CLOUD_RUNNING,
    label: '索引中',
    sort: 30,
    meta: '{"tone":"amber"}'
  },
  {
    value: '010',
    key: DICT_KEY.CLOUD_SUCCEEDED,
    label: '已上云',
    sort: 40,
    meta: '{"tone":"emerald"}'
  },
  {
    value: '011',
    key: DICT_KEY.CLOUD_FAILED,
    label: '同步失败',
    sort: 50,
    meta: '{"tone":"destructive"}'
  },
  { value: '012', key: DICT_KEY.SCOPE_USER, label: '个人', sort: 10, meta: null },
  { value: '013', key: DICT_KEY.SCOPE_TENANT, label: '租户', sort: 20, meta: null },
  { value: '014', key: DICT_KEY.RUN_PENDING, label: '等待', sort: 10, meta: null },
  { value: '015', key: DICT_KEY.RUN_RUNNING, label: '执行中', sort: 20, meta: null },
  { value: '016', key: DICT_KEY.RUN_SUCCEEDED, label: '成功', sort: 30, meta: null },
  { value: '017', key: DICT_KEY.RUN_FAILED, label: '失败', sort: 40, meta: null },
  { value: '018', key: DICT_KEY.TRIGGER_SCHEDULE, label: '按时', sort: 10, meta: null },
  { value: '019', key: DICT_KEY.TRIGGER_MANUAL, label: '手动', sort: 20, meta: null },
  { value: '020', key: DICT_KEY.TRIGGER_CATCHUP, label: '补跑', sort: 30, meta: null },
  { value: '021', key: DICT_KEY.OWNER_CLIENT, label: '本机', sort: 10, meta: null },
  { value: '022', key: DICT_KEY.OWNER_GOOSE, label: 'Goose', sort: 20, meta: null },
  { value: '023', key: DICT_KEY.OWNER_CLOUD, label: '云端', sort: 30, meta: null },
  { value: '024', key: DICT_KEY.RUN_AS_USER, label: '用户', sort: 10, meta: null },
  { value: '025', key: DICT_KEY.RUN_AS_TENANT, label: '租户', sort: 20, meta: null },
  { value: '026', key: DICT_KEY.DRAFT_PENDING, label: '待确认', sort: 10, meta: null },
  { value: '027', key: DICT_KEY.DRAFT_SAVED, label: '已保存', sort: 20, meta: null },
  { value: '028', key: DICT_KEY.DRAFT_DISCARDED, label: '已丢弃', sort: 30, meta: null },
  { value: '029', key: DICT_KEY.ACTIVE, label: '正常', sort: 10, meta: null },
  { value: '030', key: DICT_KEY.ARCHIVED, label: '已归档', sort: 90, meta: null }
] as const satisfies ReadonlyArray<DictPoolItem>

/** key → 全局 value（字面量，索引已知 key 不必 `!`） */
type DictValueByKey = {
  [E in (typeof DICT_POOL)[number] as E['key']]: E['value']
}

const DICT_VALUE_BY_KEY = Object.fromEntries(
  DICT_POOL.map(function (item) {
    return [item.key, item.value]
  })
) as DictValueByKey

function findDictValue(key: string): string | undefined {
  return (DICT_VALUE_BY_KEY as Record<string, string>)[key]
}

/** 旧 (typeCode, oldValue) → 新 value */
const DICT_REMAP: ReadonlyArray<{ typeCode: string; old: string; new: string }> = [
  { typeCode: 'knowledge_doc_status', old: '001', new: '001' },
  { typeCode: 'knowledge_doc_status', old: '002', new: '002' },
  { typeCode: 'knowledge_doc_source', old: '001', new: '003' },
  { typeCode: 'knowledge_doc_source', old: '002', new: '004' },
  { typeCode: 'knowledge_doc_source', old: '003', new: '005' },
  { typeCode: 'knowledge_doc_source', old: '004', new: '006' },
  { typeCode: 'knowledge_cloud_status', old: '001', new: '007' },
  { typeCode: 'knowledge_cloud_status', old: '002', new: '008' },
  { typeCode: 'knowledge_cloud_status', old: '003', new: '009' },
  { typeCode: 'knowledge_cloud_status', old: '004', new: '010' },
  { typeCode: 'knowledge_cloud_status', old: '005', new: '011' },
  { typeCode: 'knowledge_base_scope', old: '001', new: '012' },
  { typeCode: 'knowledge_base_scope', old: '002', new: '013' },
  { typeCode: 'automation_run_status', old: '001', new: '014' },
  { typeCode: 'automation_run_status', old: '002', new: '015' },
  { typeCode: 'automation_run_status', old: '003', new: '016' },
  { typeCode: 'automation_run_status', old: '004', new: '017' },
  { typeCode: 'automation_trigger_kind', old: '001', new: '018' },
  { typeCode: 'automation_trigger_kind', old: '002', new: '019' },
  { typeCode: 'automation_trigger_kind', old: '003', new: '020' },
  { typeCode: 'automation_owner', old: '001', new: '021' },
  { typeCode: 'automation_owner', old: '002', new: '022' },
  { typeCode: 'automation_owner', old: '003', new: '023' },
  { typeCode: 'automation_run_as', old: '001', new: '024' },
  { typeCode: 'automation_run_as', old: '002', new: '025' },
  { typeCode: 'directive_draft_status', old: '001', new: '026' },
  { typeCode: 'directive_draft_status', old: '002', new: '027' },
  { typeCode: 'directive_draft_status', old: '003', new: '028' },
  { typeCode: 'asset_status', old: '001', new: '029' },
  { typeCode: 'album_status', old: '001', new: '029' }
]

interface DictClaim {
  value: string
  isDefault: boolean
}

const DICT_CLAIMS: Record<string, readonly DictClaim[]> = {
  knowledge_doc_status: [
    { value: '001', isDefault: true },
    { value: '002', isDefault: false },
    { value: '030', isDefault: false }
  ],
  knowledge_doc_source: [
    { value: '003', isDefault: true },
    { value: '004', isDefault: false },
    { value: '005', isDefault: false },
    { value: '006', isDefault: false }
  ],
  knowledge_cloud_status: [
    { value: '007', isDefault: true },
    { value: '008', isDefault: false },
    { value: '009', isDefault: false },
    { value: '010', isDefault: false },
    { value: '011', isDefault: false }
  ],
  knowledge_base_scope: [
    { value: '012', isDefault: true },
    { value: '013', isDefault: false }
  ],
  automation_run_status: [
    { value: '014', isDefault: true },
    { value: '015', isDefault: false },
    { value: '016', isDefault: false },
    { value: '017', isDefault: false }
  ],
  automation_trigger_kind: [
    { value: '018', isDefault: true },
    { value: '019', isDefault: false },
    { value: '020', isDefault: false }
  ],
  automation_owner: [
    { value: '021', isDefault: true },
    { value: '022', isDefault: false },
    { value: '023', isDefault: false }
  ],
  automation_run_as: [
    { value: '024', isDefault: true },
    { value: '025', isDefault: false }
  ],
  directive_draft_status: [
    { value: '026', isDefault: true },
    { value: '027', isDefault: false },
    { value: '028', isDefault: false }
  ],
  asset_status: [
    { value: '029', isDefault: true },
    { value: '030', isDefault: false }
  ],
  album_status: [
    { value: '029', isDefault: true },
    { value: '030', isDefault: false }
  ]
}

const DICT_TYPES: ReadonlyArray<{
  code: string
  name: string
  description: string
}> = [
  { code: 'knowledge_doc_status', name: '文档状态', description: '知识库文档发布状态' },
  { code: 'knowledge_doc_source', name: '文档来源', description: '知识库文档写入来源' },
  { code: 'knowledge_cloud_status', name: '云端索引状态', description: '本地云端索引同步状态' },
  { code: 'knowledge_base_scope', name: '知识库范围', description: '个人或租户共享' },
  { code: 'automation_run_status', name: '自动化运行状态', description: '定时任务单次运行状态' },
  { code: 'automation_trigger_kind', name: '自动化触发方式', description: '准点 / 手动 / 补跑' },
  { code: 'automation_owner', name: '自动化执行方', description: '本机 / goose / 云端' },
  { code: 'automation_run_as', name: '自动化运行身份', description: '用户或租户身份' },
  { code: 'directive_draft_status', name: '指令草稿状态', description: '待确认 / 已保存 / 已丢弃' },
  { code: 'asset_status', name: '资源状态', description: '本地资源状态' },
  { code: 'album_status', name: '相簿状态', description: '捕获库相簿状态' }
]

export type { DictTypeCode, DictKey, DictPoolItem, DictClaim }
export {
  DICT_REVISION,
  DICT_TYPE,
  DICT_KEY,
  DICT_POOL,
  DICT_VALUE_BY_KEY,
  DICT_REMAP,
  DICT_CLAIMS,
  DICT_TYPES,
  findDictValue
}
