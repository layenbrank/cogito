import { downloadFile } from '@/utils/http/download.ts'
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
  currency?: string
}

interface ReconciliationTotals {
  usageAmount: number
  orderAmount: number
  delta: number
  usageRequests: number
  unpricedRequests: number
  failedRequests: number
  mismatchedAmount: number
  mismatchedOrderAmount: number
  paidOrders: number
}

interface ReconciliationTenant {
  tenantID: string | null
  totals: ReconciliationTotals
}

interface ReconciliationModel {
  tenantID: string | null
  modelID: string
  modelName?: string
  priceID?: string
  currency?: string
  inputPricePerMillion?: number
  outputPricePerMillion?: number
  promptTokens: number
  completionTokens: number
  requests: number
  amount?: number
  mismatchedCurrency: boolean
}

interface ReconciliationException {
  kind: string
  description: string
  tenantID?: string
  modelID?: string
  orderNo?: string
  amount?: number
  detail: string
}

/** 对账完整结果：合计 + 租户/型号明细 + 异常清单 */
interface ReconciliationReport {
  from: number
  to: number
  currency: string
  totals: ReconciliationTotals
  tenants: ReconciliationTenant[]
  models: ReconciliationModel[]
  exceptions: ReconciliationException[]
}

const ENV = { env: 'cogito' as const }

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
  return unwrap(http.get<RSF<ReconciliationReport>>('/billing/reconciliation', { ...ENV, query }))
}

function EXPORT_BILLING_RECONCILIATION(
  query: ReconciliationQuery & { format?: 'csv' | 'ndjson' } = {}
) {
  const { format = 'csv', ...rest } = query
  return downloadFile('/billing/reconciliation/export', `billing-reconciliation.${format}`, {
    ...rest,
    format
  })
}

export {
  DELETE_BILLING_PRICE,
  EXPORT_BILLING_RECONCILIATION,
  GET_BILLING_PRICES,
  GET_BILLING_RECONCILIATION,
  POST_BILLING_PRICE,
  PUT_BILLING_PRICE
}
export type {
  BillingPrice,
  PriceWrite,
  ReconciliationException,
  ReconciliationModel,
  ReconciliationQuery,
  ReconciliationReport,
  ReconciliationTenant,
  ReconciliationTotals
}
