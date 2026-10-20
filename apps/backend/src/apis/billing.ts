import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

interface BillingPrice {
  id: string
  tenantID: string | null
  modelID: string
  modelName?: string
  currency: string
  inputPerMTok: number
  outputPerMTok: number
  effectiveFrom: number
  effectiveTo: number | null
  createdAt: number
  updatedAt: number
}

interface PriceWrite {
  tenantID?: string | null
  modelID: string
  currency?: string
  inputPerMTok: number
  outputPerMTok: number
  effectiveFrom?: number
  effectiveTo?: number | null
}

interface ReconciliationQuery {
  from?: number
  to?: number
  tenantID?: string
}

interface ReconciliationRow {
  tenantID: string | null
  modelID: string
  totalTokens: number
  amount: number
}

const ENV = { env: 'thinking' as const }

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

function GET_BILLING_PRICES() {
  return unwrap(http.get<RSF<BillingPrice[]>>('/billing/prices', ENV))
}

function POST_BILLING_PRICE(body: PriceWrite) {
  return unwrap(http.post<RSF<BillingPrice>>('/billing/prices', body, ENV))
}

function PUT_BILLING_PRICE(id: string, body: Partial<PriceWrite>) {
  return unwrap(http.put<RSF<BillingPrice>>(`/billing/prices/${id}`, body, ENV))
}

function DELETE_BILLING_PRICE(id: string) {
  return unwrap(http.delete<RSF<null>>(`/billing/prices/${id}`, ENV))
}

function GET_BILLING_RECONCILIATION(query: ReconciliationQuery = {}) {
  return unwrap(http.get<RSF<ReconciliationRow[]>>('/billing/reconciliation', { ...ENV, query }))
}

export {
  DELETE_BILLING_PRICE,
  GET_BILLING_PRICES,
  GET_BILLING_RECONCILIATION,
  POST_BILLING_PRICE,
  PUT_BILLING_PRICE
}
export type { BillingPrice, PriceWrite, ReconciliationQuery, ReconciliationRow }
