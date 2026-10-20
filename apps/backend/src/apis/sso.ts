import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

interface SsoConnection {
  id: string
  tenantID: string
  provider: string
  issuer: string
  clientID: string
  redirectUri: string
  status: string
  createdAt: number
  updatedAt: number
}

interface SsoWrite {
  tenantID: string
  provider: string
  issuer: string
  clientID: string
  clientSecret: string
  redirectUri: string
  status?: string
}

interface SsoUpdate {
  issuer?: string
  clientID?: string
  clientSecret?: string
  redirectUri?: string
  status?: string
}

const ENV = { env: 'thinking' as const }

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

function GET_SSO_CONNECTIONS() {
  return unwrap(http.get<RSF<SsoConnection[]>>('/sso/connections', ENV))
}

function POST_SSO_CONNECTION(body: SsoWrite) {
  return unwrap(http.post<RSF<SsoConnection>>('/sso/connections', body, ENV))
}

function PUT_SSO_CONNECTION(id: string, body: SsoUpdate) {
  return unwrap(http.put<RSF<SsoConnection>>(`/sso/connections/${id}`, body, ENV))
}

function DELETE_SSO_CONNECTION(id: string) {
  return unwrap(http.delete<RSF<null>>(`/sso/connections/${id}`, ENV))
}

export { DELETE_SSO_CONNECTION, GET_SSO_CONNECTIONS, POST_SSO_CONNECTION, PUT_SSO_CONNECTION }
export type { SsoConnection, SsoUpdate, SsoWrite }
