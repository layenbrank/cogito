/**
 * Engine 领域 IPC（Bing 搜索建议）
 */
import { generateSecureCvid } from '@i-thinking/utils'

import { ipcInvoke, parseData } from '@/lib/ipc'
import { DAEMON, DAEMON_ACTION } from '@/shared/ipc/channels'

const CVID = generateSecureCvid()

const PT = 'page.home'
const CSR = '1'
const PTHS = '1'

type SuggestionEnvelope = {
  data: Engine.Suggestion
}

function parseSuggestion(payload: unknown): Engine.Suggestion {
  if (!payload || typeof payload !== 'object') {
    throw new Error('IPC suggestion 无效')
  }

  const record = payload as Record<string, unknown>

  if (Array.isArray(record.s)) {
    return record as unknown as Engine.Suggestion
  }

  const nested = record.data
  if (nested && typeof nested === 'object' && Array.isArray((nested as Engine.Suggestion).s)) {
    return nested as Engine.Suggestion
  }

  throw new Error('IPC suggestion 缺少 s')
}

async function suggestion(qry: string): Promise<Engine.Suggestion> {
  const resp = await ipcInvoke(
    DAEMON.ENGINE,
    {
      pt: PT,
      qry,
      cp: qry.length,
      csr: CSR,
      pths: PTHS,
      cvid: CVID
    },
    DAEMON_ACTION.ENGINE.SUGGESTION
  )
  const payload = parseData<Engine.Suggestion | SuggestionEnvelope>(resp)
  return parseSuggestion(payload)
}

const EngineIpc = {
  suggestion
}

export { EngineIpc }
